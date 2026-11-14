/**
 * Production bridge: workspace-aware ToolRegistry -> agent loop contract.
 *
 * The agent loop (model-services) speaks {name, description,
 * parametersJsonSchema, supportsParallel} tool definitions plus a flat
 * executeTool callback. The production registry (ai/toolRegistry.ts) speaks
 * permission-gated typed ToolResults bound to a WorkspaceIndex. This module
 * adapts one to the other without duplicating policy: permission gating stays
 * in ToolRegistry.run, loop-level mode gating stays in agentLoop.
 *
 * Parallelism policy (Codex supports_parallel_tool_calls analogue): pure
 * read/analyze tools may run concurrently within one model turn; anything
 * that proposes, validates or rolls back stays exclusive. Results are
 * recorded in model emission order by the loop itself.
 *
 * Schema policy: each tool's model-facing parametersJsonSchema is *projected*
 * from the same ToolInputShape that ToolRegistry.run enforces at runtime
 * (toolInputShapeToJsonSchema). Before this, every tool advertised a bare
 * `{ type: 'object' }`, which told the model nothing about field names —
 * the model had to guess `q` vs `query`, `id` vs `textId`, and a wrong guess
 * came back as INVALID_INPUT with no way for the model to know the real name.
 * That was the root cause of unreliable tool calling, and it is exactly the
 * failure a projection cannot reintroduce: rename a field in the shape and
 * the advertised schema follows.
 */
import type { ToolCall, ToolDefinition as AgentToolDefinition } from '../model-services/types.js';
import { type NativeReadCompleteness } from '@soulforge/shared';
import { type ToolContext, type ToolRegistry } from './toolRegistry.js';
import { type EvidenceClaimsTransport } from '../model-services/evidenceTransport.js';
export interface AgentToolBridgeOptions {
    registry: ToolRegistry;
    context: ToolContext;
    /** Re-read mutable host state before every tool call in a long-lived run. */
    contextProvider?: () => ToolContext;
    /**
     * @deprecated Kept for compatibility with older hosts. Discovery is no
     * longer blocked on a previous text query; the bridge returns a deterministic
     * candidate/native-evidence status and native read/write contracts enforce
     * the actual evidence boundary.
     */
    requireTextLookupBeforeStructuredDiscovery?: boolean;
}
export interface AgentToolBridge {
    tools: AgentToolDefinition[];
    /**
     * 执行一次工具调用。`contextOverride` 由宿主（main）在需要注入生产上下文的
     * 调用（如回滚：session / 生产 store / 备份目录 / 用户确认凭据）时提供，
     * 与桥闭包里的基础 context 浅合并；纯读工具调用不传即行为不变。
     */
    executeTool: (call: ToolCall, contextOverride?: Partial<ToolContext>) => Promise<{
        ok: boolean;
        content: string;
        code?: string;
    }>;
}
/**
 * Discovery/outline results are context, not a dump of the entire index or
 * native document. Keep the model-facing payload small and leave it enough
 * stable identifiers/cursors to request the next page explicitly.
 */
export declare const MAX_BOUNDED_TOOL_RESULT_CHARS = 65536;
export declare const MAX_BOUNDED_TOOL_RESULT_BYTES = 65536;
export declare const AGENT_TOOL_RESULT_INSTRUCTIONS = "\u8FD4\u56DE\u56FA\u5B9A\u7ED3\u679C envelope\uFF1Astate\u3001data\u3001pagination\u3001truncated\u3001identifiers\u3001evidence\uFF1Bpagination.truncated \u4EC5\u8868\u793A\u903B\u8F91\u7ED3\u679C\u6709\u540E\u9875\uFF0Cpagination.deliveryTruncated \u8868\u793A\u4F20\u8F93\u6458\u8981\u7701\u7565\u4E86\u7EC6\u8282\u800C\u975E\u5B58\u5728\u6E38\u6807\uFF1B\u6309 nextActions/nextReadPlan \u6062\u590D\u7EC6\u8282\u3002state=committed \u8868\u793A\u4E8B\u52A1\u5DF2\u843D\u76D8\uFF0Cverification_failed \u8868\u793A\u5DF2\u843D\u76D8\u4F46\u539F\u751F\u590D\u8BFB\u5931\u8D25\uFF0C\u4E0D\u80FD\u6309\u666E\u901A\u5931\u8D25\u91CD\u8BD5\uFF1B\u5927\u578B\u7ED3\u679C\u53EA\u5728 data.summary \u4E2D\u6458\u8981\uFF0C\u4E0D\u80FD\u6309\u539F\u59CB typed response \u89E3\u8BFB\u3002data.record \u662F\u4E3B\u8F7D\u8377\uFF1Bdata.items \u53EA\u5728\u5DE5\u5177\u4EA4\u4ED8\u6761\u76EE\u6570\u7EC4\u65F6\u51FA\u73B0\uFF0C\u5BF9\u8C61\u8F7D\u8377\u4E0D\u4F1A\u9644\u5E26\u7A7A items \u2014\u2014 \u7A7A\u6570\u7EC4\u4E0D\u7B49\u4E8E\u300C\u6CA1\u6709\u7ED3\u679C\u300D\u3002evidence \u53EA\u8868\u793A\u786E\u5B9A\u6027\u6765\u6E90\u72B6\u6001\uFF0C\u4E0D\u662F\u6A21\u578B\u7F6E\u4FE1\u5EA6\u5206\u6570\u3002evidence.claimDefaults \u662F\u5404\u6761 claims \u5171\u7528\u7684\u5B8C\u6574\u5B57\u6BB5\uFF08identity \u6309\u5C5E\u6027\u5408\u5E76\uFF09\uFF0C\u5355\u6761\u5B57\u6BB5\u8986\u76D6\u9ED8\u8BA4\u503C\uFF1B\u7701\u7565\u7684 key/resourceKey \u53EF\u7531\u5B8C\u6574 identity \u65E0\u635F\u91CD\u5EFA\u3002";
export type AgentEvidenceStatus = 'not_applicable' | 'candidate' | 'native-verified' | 'insufficient_evidence';
export type AgentEvidenceKind = 'discovery' | 'rag' | 'native-read' | 'proposal' | 'validation' | 'mutation' | 'memory' | 'other';
export type AgentToolSuccessState = 'completed' | 'staged' | 'committed' | 'verification_failed' | 'unsupported' | 'ambiguous' | 'stale' | 'cancelled' | 'insufficient_evidence';
/**
 * Agent-facing evidence is a finite workflow state, not a probability. A
 * candidate can guide the next lookup, while only a native read carrying a
 * source hash can support a native edit boundary.
 */
export interface AgentEvidenceMetadata extends EvidenceClaimsTransport {
    status: AgentEvidenceStatus;
    kind: AgentEvidenceKind;
    sourceUris: string[];
    sourceHashes: string[];
    sourceRevisions: Array<number | string>;
    nextActions: string[];
    repeatedQuery: boolean;
}
export interface AgentToolResultEnvelope {
    ok: true;
    state: AgentToolSuccessState;
    data: {
        /**
         * 只有当工具真正返回一个条目数组（裸数组载荷）时存在。
         *
         * 以前这里恒为数组：对象载荷被塞进 `items: []` 再配 `record`，于是 63/64 个工具
         * 的答案都长成「items 空 + record 有货」。调用方看到 `items: []` 最自然的读法是
         * 「这个查询没有结果」——一个空数组在说谎。现在对象载荷不带 items，主载荷是
         * record；只有裸数组工具才发 items。
         */
        items?: unknown[];
        record: Record<string, unknown> | null;
        scalar: string | number | boolean | null;
        summary: string | null;
    };
    pagination: {
        originalChars: number;
        originalBytes?: number;
        returnedCount: number | null;
        totalCount: number | null;
        /** Native/logical result total when the tool exposes a page window. */
        total: number | null;
        /** Native/logical zero-based page offset when the tool exposes one. */
        offset: number | null;
        /** Native/logical page limit when the tool exposes one. */
        limit: number | null;
        /** Whether the underlying tool result has more data beyond this window. */
        truncated: boolean;
        /** Transport projection lost detail; not a claim that a logical next page exists. */
        deliveryTruncated: boolean;
        cursors: Record<string, string>;
        continuationParams?: Record<string, unknown>;
    };
    completeness?: NativeReadCompleteness;
    truncated: boolean;
    identifiers: string[];
    evidence: AgentEvidenceMetadata;
}
export { projectSessionTransactionFrame } from './operationReceipt.js';
export declare function modelFacingEntryName(value: string): string;
export declare function createAgentToolBridge(options: AgentToolBridgeOptions): AgentToolBridge;
