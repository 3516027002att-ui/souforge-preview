/**
 * Agent session host: runs one agent session end-to-end — file rollout
 * recording, event emission and cancellation around the shared finite kernel.
 * Host-agnostic (no Electron imports): callers inject the sessions base dir,
 * the model adapter and the tool surface. Desktop wires it to userData +
 * credential vault + workspace tool registry.
 */
import { type ProviderBudgetStats } from '../../../agent/src/providerBudget.mjs';
import type { AgentProtocolEvent, FiniteAgentResult, KernelLimits } from '../../../agent/src/index.mjs';
import type { ResumedRollout } from './rolloutRecorder.js';
import type { AgentEvent, AgentPermissionMode, AgentRunResult, ApprovalDiff, ApprovalRequest, ApprovalResponse, ChatMessageImage, CompactionOptions, ContextBroker, ContextBrokerOptions, ModelServiceAdapter, ModelServiceConfig, ProviderUsageSample, ModelSamplingOptions, RetryPolicyOptions, ToolCall, ToolDefinition } from './types.js';
export interface AgentSessionRunParams {
    /** Compatibility input; the only production kernel is finite. */
    kernel?: 'finite';
    runId?: string;
    requestId?: string;
    kernelLimits?: KernelLimits;
    pricing?: {
        inputPerMillion: number;
        outputPerMillion: number;
    };
    onProtocolEvent?: (event: AgentProtocolEvent) => void;
    /** Base directory for rollout files (desktop: userData/agent). */
    sessionsDir: string;
    /** Pre-generated session id; defaults to a fresh UUID. */
    sessionId?: string;
    adapter: ModelServiceAdapter;
    config: ModelServiceConfig;
    /** Main-process only — never forwarded to events or renderer payloads. */
    apiKey: string;
    prompt: string;
    /**
     * Current host policy for this run. Resumed system messages are discarded:
     * old policy, permission notices and transient host instructions never
     * outrank the current host configuration.
     */
    systemPrompt?: string;
    permissionMode: AgentPermissionMode;
    tools: ToolDefinition[];
    executeTool: (call: ToolCall, contextOverride?: Record<string, unknown>) => Promise<{
        ok: boolean;
        content: string;
        code?: string;
    }>;
    signal?: AbortSignal;
    streaming?: boolean;
    /**
     * Approval channel. Required approvals without a channel wait with a concrete proposal.
     * A trusted host may explicitly grant an empty approvalRequiredLevels list.
     */
    requestApproval?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
    /** Resolve a unified diff for a pending change; needs filesystem access. */
    resolveApprovalDiff?: (input: {
        toolName: string;
        argumentsJson: string;
    }) => Promise<ApprovalDiff | null>;
    approvalRequiredLevels?: readonly string[];
    /** Workspace evidence assembler injected before each model call. */
    contextBroker?: ContextBroker;
    contextBrokerOptions?: ContextBrokerOptions;
    retryPolicy?: RetryPolicyOptions;
    streamMaxRetries?: number;
    compaction?: CompactionOptions;
    maxSteps?: number;
    timeoutMs?: number;
    maxTotalOutputTokens?: number;
    /** Sampling / capability parameters applied to every model call in this run. */
    sampling?: ModelSamplingOptions;
    /** RAG auto-search hook forwarded to the loop; absent means no auto-injection. */
    ragSearch?: NonNullable<import('./types.js').AgentRunRequest['ragSearch']>;
    /** Prior rollout to continue from; its messages seed the new run. */
    resumeFrom?: ResumedRollout;
    /** Persist every real provider request (including retry/compaction calls). */
    recordProviderUsage?: (sample: ProviderUsageSample) => Promise<void>;
    /**
     * 用户随本条 prompt 提交的图像（多模态）。只挂在本轮 user 消息上下发给
     * 模型，不写入 rollout（rollout 保持文本形态）。
     */
    userImages?: readonly ChatMessageImage[];
    onEvent?: (event: AgentEvent) => void;
}
export interface AgentSessionRunResult {
    sessionId: string;
    rolloutPath: string;
    run: AgentRunResult;
    kernel: FiniteAgentResult;
    providerBudget?: ProviderBudgetStats;
}
/** Process result DTO. The complete transcript stays in the durable rollout. */
export interface AgentSessionTerminalResult extends AgentSessionRunResult {
    historyDelivery: {
        source: 'rollout';
        messageCount: number;
        omitted: true;
    };
}
export declare function toAgentSessionTerminalResult(result: AgentSessionRunResult): AgentSessionTerminalResult;
export declare function runAgentSession(params: AgentSessionRunParams): Promise<AgentSessionRunResult>;
