/**
 * Agent session host: runs one agent session end-to-end — file rollout
 * recording, event emission and cancellation around the shared finite kernel.
 * Host-agnostic (no Electron imports): callers inject the sessions base dir,
 * the model adapter and the tool surface. Desktop wires it to userData +
 * credential vault + workspace tool registry.
 */
import { createProviderBudget } from '../../../agent/src/providerBudget.mjs';
import { runFiniteAgentAdapter } from './finiteAgentAdapter.js';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from './agentPolicy.js';
import { FileRolloutStorage, newRolloutFilePath } from './fileRolloutStorage.js';
import { RolloutRecorder } from './rolloutRecorder.js';
import { estimateContextTokens } from './contextCompactor.js';
import { CredentialStreamRedactor } from './credentialStreamRedactor.js';
import { AGENT_TOOL_RESULT_INSTRUCTIONS } from '../ai/agentToolBridge.js';
export function toAgentSessionTerminalResult(result) {
    return {
        ...result,
        run: { ...result.run, messages: [] },
        kernel: { ...result.kernel, messages: [] },
        historyDelivery: { source: 'rollout', messageCount: result.run.messages.length, omitted: true }
    };
}
export async function runAgentSession(params) {
    if (params.kernel !== undefined && params.kernel !== 'finite')
        throw Object.assign(new Error('The legacy production kernel was retired; explicit experiments use the pinned Git baseline.'), { code: 'AGENT_LEGACY_KERNEL_RETIRED' });
    const sessionId = params.sessionId ?? randomUUID();
    const startedAt = new Date();
    const rolloutPath = newRolloutFilePath(params.sessionsDir, sessionId, startedAt);
    const storage = new FileRolloutStorage(rolloutPath);
    const recorder = new RolloutRecorder(storage, {
        sessionId,
        startedAt: startedAt.toISOString(),
        configId: params.config.id,
        protocol: params.config.protocol,
        permissionMode: params.permissionMode,
        ...(params.config.model ? { model: params.config.model } : {})
    });
    const redactActual = (text) => redactSecrets(params.apiKey ? text.replaceAll(params.apiKey, '[REDACTED]') : text);
    const emitProtocol = (envelope) => {
        const safe = JSON.parse(JSON.stringify(envelope, (_key, value) => typeof value === 'string' ? redactActual(value) : value));
        recorder.enqueue({ type: 'protocol-event', envelope: safe });
        params.onProtocolEvent?.(safe);
    };
    let providerCallIndex = 0;
    const usagePersistenceErrors = [];
    const persistUsage = async (callIndex, estimatedContextTokens, usage) => {
        const providerReported = usage?.inputTokens !== undefined || usage?.outputTokens !== undefined;
        const sample = {
            callIndex,
            ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
            ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
            currentContextTokens: usage?.inputTokens ?? estimatedContextTokens,
            contextSource: usage?.inputTokens !== undefined ? 'provider' : 'estimated',
            providerReported,
            recordedAt: new Date().toISOString()
        };
        // The session rollout is the per-session durable audit source.  The
        // desktop callback additionally indexes the same idempotent sample in
        // app.db for fast historical totals in Settings.
        recorder.enqueue({ type: 'provider-usage', ...sample });
        if (!params.recordProviderUsage)
            return;
        try {
            await params.recordProviderUsage(sample);
        }
        catch (error) {
            usagePersistenceErrors.push(error instanceof Error ? error.message : String(error));
        }
    };
    const trackedAdapter = {
        protocol: params.adapter.protocol,
        listModels: (options) => params.adapter.listModels({ ...options, sessionId: options?.sessionId ?? sessionId }),
        complete: async (request) => {
            const callIndex = ++providerCallIndex;
            const estimated = estimateContextTokens(request.messages);
            const result = await params.adapter.complete({ ...request, sessionId: request.sessionId ?? sessionId });
            await persistUsage(callIndex, estimated, result.usage);
            return { ...result, message: { ...result.message, content: redactActual(result.message.content),
                    ...(result.message.toolCalls ? { toolCalls: result.message.toolCalls.map(call => ({ ...call, argumentsJson: redactActual(call.argumentsJson) })) } : {}) },
                diagnostics: result.diagnostics.map(diagnostic => ({ ...diagnostic, message: redactActual(diagnostic.message) })) };
        },
        stream: async function* (request) {
            const callIndex = ++providerCallIndex;
            const estimated = estimateContextTokens(request.messages);
            let inputTokens;
            let outputTokens;
            const redactors = {
                'text-delta': new CredentialStreamRedactor(params.apiKey, redactActual),
                'thinking-delta': new CredentialStreamRedactor(params.apiKey, redactActual)
            };
            try {
                for await (const event of params.adapter.stream({ ...request, sessionId: request.sessionId ?? sessionId })) {
                    if (event.type === 'usage') {
                        if (event.inputTokens !== undefined)
                            inputTokens = event.inputTokens;
                        if (event.outputTokens !== undefined)
                            outputTokens = event.outputTokens;
                    }
                    if (event.type === 'text-delta' || event.type === 'thinking-delta') {
                        for (const safe of redactors[event.type].push(event))
                            yield safe;
                    }
                    else if (event.type === 'message-stop') {
                        for (const redactor of Object.values(redactors))
                            for (const safe of redactor.flush())
                                yield safe;
                        yield event;
                    }
                    else if (event.type === 'tool-call')
                        yield { ...event, toolCall: { ...event.toolCall, argumentsJson: redactActual(event.toolCall.argumentsJson) } };
                    else if (event.type === 'error')
                        yield { ...event, message: redactActual(event.message) };
                    else
                        yield event;
                }
                for (const redactor of Object.values(redactors))
                    for (const safe of redactor.flush())
                        yield safe;
            }
            finally {
                await persistUsage(callIndex, estimated, {
                    ...(inputTokens !== undefined ? { inputTokens } : {}),
                    ...(outputTokens !== undefined ? { outputTokens } : {})
                });
            }
        }
    };
    const providerBudget = createProviderBudget(trackedAdapter, {
        maxOutputTokens: params.maxTotalOutputTokens ?? params.kernelLimits?.maxOutputTokens ?? 100_000,
        ...(params.kernelLimits?.maxCost != null ? { maxCost: params.kernelLimits.maxCost } : {}),
        ...(params.pricing ? { pricing: params.pricing } : {})
    });
    const activeAdapter = providerBudget.adapter;
    const messages = [];
    const resumedMessages = (params.resumeFrom?.messages ?? [])
        .filter((message) => message.role !== 'system');
    if (params.systemPrompt !== undefined && params.systemPrompt.length > 0) {
        messages.push({ role: 'system', content: params.systemPrompt });
    }
    if (params.tools.length > 0 && !messages.some(message => message.content === AGENT_TOOL_RESULT_INSTRUCTIONS))
        messages.push({ role: 'system', content: AGENT_TOOL_RESULT_INSTRUCTIONS });
    if (params.permissionMode === 'full') {
        messages.push({
            role: 'system',
            content: '【系统运行模式通知】：当前环境已分配完整写入权限（fullPermission 模式）。用户指令为明确的修改任务；在完成必要的名称、参数和事件原生定位与核对后，应直接调用写入工具（如 mutate_param_fields、apply_emevd_dsl 等）实施修改、提交并原生回读验证，无须停下等待二次确认。'
        });
    }
    messages.push(...resumedMessages);
    messages.push({
        role: 'user',
        content: params.prompt,
        ...(params.userImages && params.userImages.length > 0 ? { images: params.userImages } : {})
    });
    // The kernel records only messages appended during execution. Seed the
    // durable rollout with the exact normalized history sent to the provider,
    // excluding this turn's transient image payload.
    for (const message of messages) {
        recorder.enqueue({
            type: 'message',
            step: 0,
            message: message.role === 'user' && message.content === params.prompt
                ? { role: 'user', content: params.prompt }
                : message
        });
    }
    // Deltas are transient UI payloads but still cross a process boundary —
    // redact secret-shaped text before emission, matching the durable policy.
    const emit = (event) => {
        const safe = JSON.parse(JSON.stringify(event, (_key, value) => typeof value === 'string' ? redactActual(value) : value));
        params.onEvent?.(safe);
    };
    let primaryError = null;
    try {
        const runRequest = {
            config: params.config,
            apiKey: params.apiKey,
            messages,
            sessionId,
            taskQuery: params.prompt,
            tools: params.tools,
            permissionMode: params.permissionMode,
            executeTool: params.executeTool,
            ...(params.maxSteps != null ? { maxSteps: params.maxSteps } : {}),
            ...(params.signal ? { signal: params.signal } : {}),
            ...(params.timeoutMs != null ? { timeoutMs: params.timeoutMs } : {}),
            ...(params.maxTotalOutputTokens != null ? { maxTotalOutputTokens: params.maxTotalOutputTokens } : {}),
            ...(params.retryPolicy ? { retryPolicy: params.retryPolicy } : {}),
            ...(params.streamMaxRetries != null ? { streamMaxRetries: params.streamMaxRetries } : {}),
            ...(params.streaming != null ? { streaming: params.streaming } : {}),
            ...(params.compaction ? { compaction: params.compaction } : {}),
            ...(params.sampling ? { sampling: params.sampling } : {}),
            ...(params.ragSearch ? { ragSearch: params.ragSearch } : {}),
            ...(params.requestApproval ? { requestApproval: params.requestApproval } : {}),
            ...(params.resolveApprovalDiff ? { resolveApprovalDiff: params.resolveApprovalDiff } : {}),
            ...(params.approvalRequiredLevels
                ? { approvalRequiredLevels: params.approvalRequiredLevels }
                : {}),
            ...(params.contextBroker ? { contextBroker: params.contextBroker } : {}),
            ...(params.contextBrokerOptions
                ? { contextBrokerOptions: params.contextBrokerOptions }
                : {}),
            onEvent: emit,
            rollout: recorder
        };
        const finite = await runFiniteAgentAdapter(activeAdapter, runRequest, {
            runId: params.runId ?? sessionId, requestId: params.requestId ?? sessionId,
            onProtocolEvent: emitProtocol,
            ...(params.kernelLimits ? { limits: params.kernelLimits } : {}),
            ...(params.pricing ? { pricing: params.pricing } : {})
        });
        const run = finite.run;
        if (usagePersistenceErrors.length > 0) {
            run.diagnostics.push({
                severity: 'warning',
                code: 'PROVIDER_USAGE_INDEX_PERSIST_FAILED',
                message: `provider usage 已写入会话 rollout，但 app.db 索引失败 ${usagePersistenceErrors.length} 次。`
            });
        }
        return { sessionId, rolloutPath, run, kernel: finite.kernel, providerBudget: providerBudget.stats() };
    }
    catch (error) {
        primaryError = error;
        recorder.enqueue({ type: 'interrupted', at: new Date().toISOString() });
        throw error;
    }
    finally {
        try {
            await recorder.close();
        }
        catch (closeError) {
            if (primaryError === null)
                throw closeError;
        }
    }
}
//# sourceMappingURL=agentSessionHost.js.map