import { randomUUID } from 'node:crypto';
import { LocalSessionHost } from '../cli/localSessionHost.js';
import { runAgentSession } from './agentSessionHost.js';
import { composeAgentSessionOptions } from './agentHostComposition.js';
/** Desktop, CLI and evaluators use one assembly surface over the same domain bridge. */
export function createAgentRunAssembly(bridge, options = {}) {
    const pendingOperations = new Set();
    let lastHost;
    const projectStatus = (status) => status ? ({
        id: status.id, state: status.state, ...(status.opIds ? { opIds: status.opIds } : {}),
        ...(status.outcome?.requestState ? { requestState: status.outcome.requestState } : {}),
        ...(status.outcome?.transaction ? { transaction: { state: status.outcome.transaction.state,
                ...(status.outcome.transaction.opId ? { opId: status.outcome.transaction.opId } : {}),
                ...(status.outcome.transaction.opIds ? { opIds: status.outcome.transaction.opIds } : {}),
                operations: status.outcome.transaction.operations.map(operation => ({ opId: operation.opId, state: operation.state })) } } : {})
    }) : undefined;
    return {
        async waitForHostOperations() {
            while (pendingOperations.size)
                await Promise.allSettled([...pendingOperations]);
        },
        getHostRequestStatuses() { return lastHost?.listRequestStatuses().map(projectStatus) ?? []; },
        async resolvePriorCallOutcome(sessionId, callId) {
            if (!options.coreSession)
                return undefined;
            const previous = new LocalSessionHost(`agent:${sessionId}`, options.coreSession.workspaceId, options.coreSession.principal, options.coreSession);
            try {
                return projectStatus(await previous.resolveRequestStatus(`${sessionId}:${callId}`));
            }
            catch {
                return projectStatus({ id: `${sessionId}:${callId}`, state: 'unknown', queuedAt: 0,
                    outcome: { id: `${sessionId}:${callId}`, ok: false, requestState: 'unknown', transaction: { state: 'unknown', operations: [] } } });
            }
        },
        async run(params) {
            const sessionId = params.sessionId ?? randomUUID();
            const host = options.coreSession ? new LocalSessionHost(`agent:${sessionId}`, options.coreSession.workspaceId, options.coreSession.principal, options.coreSession) : undefined;
            lastHost = host;
            const dispatchTool = host ? async (call, override = {}) => {
                let args;
                try {
                    args = JSON.parse(call.argumentsJson || '{}');
                }
                catch {
                    return bridge.executeTool(call, override);
                }
                const outcome = await host.dispatch({ id: `${sessionId}:${call.id}`, tool: call.name, args }, (_tool, _args, signal) => bridge.executeTool(call, { ...override, ...(signal ? { signal } : {}) }), override.signal ?? params.signal);
                // Storage owns this contract. Older hosts expose only result; the
                // integrated host additionally preserves request/transaction truth.
                const hostOutcome = outcome;
                const result = hostOutcome.result;
                const transaction = hostOutcome.transaction ? {
                    state: hostOutcome.transaction.state,
                    ...(hostOutcome.transaction.opId ? { opId: hostOutcome.transaction.opId } : {}),
                    ...(hostOutcome.transaction.opIds ? { opIds: hostOutcome.transaction.opIds } : {}),
                    operations: hostOutcome.transaction.operations.map(operation => ({ opId: operation.opId, state: operation.state }))
                } : undefined;
                const requestState = hostOutcome.requestState;
                if (result && typeof result.content === 'string' && typeof result.ok === 'boolean') {
                    let payload;
                    try {
                        payload = JSON.parse(result.content);
                    }
                    catch {
                        payload = { content: result.content };
                    }
                    return { ...result, content: JSON.stringify({ ...payload, ...(requestState ? { requestState } : {}), ...(transaction ? { transaction } : {}) }) };
                }
                return { ok: false, code: hostOutcome.error?.code ?? 'AGENT_HOST_RESULT_UNAVAILABLE', content: JSON.stringify({ ok: false, error: hostOutcome.error, ...(requestState ? { requestState } : {}), ...(transaction ? { transaction } : {}) }) };
            } : bridge.executeTool;
            const executeTool = (call, override) => {
                const task = Promise.resolve().then(() => dispatchTool(call, override));
                pendingOperations.add(task);
                void task.then(() => pendingOperations.delete(task), () => pendingOperations.delete(task));
                return task;
            };
            return (options.sessionRunner ?? runAgentSession)({ ...composeAgentSessionOptions(params, options.composition), sessionId, tools: bridge.tools, executeTool });
        }
    };
}
//# sourceMappingURL=agentRunAssembly.js.map