import type { AiToolPermissionLevel, ConfirmationReceipt } from '@soulforge/shared';
import { type OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { RagCorpus } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import type { KnowledgeRefreshResult } from '../indexing/knowledgeRefresh.js';
import { type NativeEditSession } from '../editing/nativeEditSession.js';
import { type MemoryStore } from '../memory/memoryStore.js';
import { type ReferenceCursorStore } from '../references/referenceCursorStore.js';
import { type NativeReadProofStore } from '../editing/nativeReadProofStore.js';
import type { DiagnosticEvent } from '../diagnostics/diagnosticEvent.js';
/** @deprecated Prefer AiToolPermissionLevel. Kept for older UI labels. */
export type ToolPermission = 'read' | 'plan' | 'write' | AiToolPermissionLevel;
/**
 * Host-resolved identity for one EMEVD event.  This is deliberately not a
 * model-facing field: the registry derives it from the current workspace
 * index and the physical path accepted by the native reader.
 */
export interface HostResolvedEmevdEventTarget {
    resourceKind: 'event';
    sourceUri: string;
    sourcePath: string;
    eventId: number;
    /** False when the resolver had to preserve an unindexed input token. */
    canonical: boolean;
}
export type KnowledgeSourceChange = readonly string[];
export type RagSnapshotScope = 'canonical-param' | 'full';
export interface ToolContext {
    workspaceIndex: WorkspaceIndex | null;
    /** Host-owned identity of the currently active workspace session. */
    workspaceSessionId?: string;
    workspaceSessionGeneration?: number;
    indexedFilesRevision?: number;
    /** Same long-lived host session used by desktop and CLI; no per-call ledger. */
    coreSession?: import('../runtime/coreToolSession.js').CoreToolSession;
    mode: 'plan' | 'normal' | 'fullPermission';
    /**
     * Immutable host grant for this run. `switch_mode` may lower/equal the
     * active mode but can never raise it above this ceiling. When omitted, the
     * initial context mode is the ceiling for backward-compatible hosts.
     */
    modeCeiling?: 'plan' | 'normal' | 'fullPermission';
    /** Agent sessions are read-only with respect to the persistent memory layer. */
    allowMemoryWrite?: boolean;
    /** Optional durable/in-memory RAG corpus. Absent falls back to building from the index. */
    rag?: RagCorpus;
    /** Host-owned native epoch that proves which WorkspaceIndex built the RAG snapshot. */
    ragEpoch?: number;
    /** Host-owned scope of the injected RAG snapshot. Missing provenance is stale. */
    ragScope?: RagSnapshotScope;
    /** Host-owned identity of the session/catalog that produced the RAG snapshot. */
    ragSessionId?: string;
    ragGeneration?: number;
    ragIndexedFilesRevision?: number;
    /** Host-owned live check used to discard RAG results after a workspace switch. */
    isWorkspaceContextCurrent?: () => boolean;
    /** Optional long-term memory store (Codex MEMORY.md persistent layer). */
    memoryStore?: MemoryStore;
    /**
     * 主进程注入的「真实写/回滚」上下文。纯读工具不需要；写级工具（回滚等）
     * 缺省时干净失败（ROLLBACK_CONTEXT_REQUIRED），绝不用内存 store 冒充生产
     * 通道 —— 之前 rollback_operation 只带内存 store 且无 confirmation，恒以
     * EDIT_CONFIRMATION_REQUIRED 失败，属于半成品，本次接通。
     */
    session?: WorkspaceSession;
    /**
     * Long-lived edit session for this subject (T03 step 1). When present,
     * requireEditSession returns it instead of minting a fresh host-handle Map
     * per tool call; read handles then survive across calls of one session.
     */
    editSession?: NativeEditSession;
    operationLogStore?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
    /** 用户对本次具体写操作的确认凭据（main 原生对话框签发，绑定操作 ID）。 */
    confirmation?: ConfirmationReceipt;
    /** Persist/rebuild RAG after a live native read enriches WorkspaceIndex. */
    onSemanticEvidenceUpdated?: (sourceUris?: KnowledgeSourceChange) => Promise<void>;
    /** Host-owned read-only query continuations; CLI may persist these across commands. */
    referenceCursorStore?: ReferenceCursorStore;
    /** Invalidate and converge knowledge after a committed native write/rollback. */
    onNativeWriteCommitted?: (changedSources: KnowledgeSourceChange) => Promise<KnowledgeRefreshResult | void>;
    /** Abort the current Agent tool call when the host cancels the run. */
    signal?: AbortSignal;
    /** Optional host-only timing/progress sink; never enters tool result data. */
    onDiagnostic?: (event: DiagnosticEvent) => void;
    /** Curator-only knowledge staging store; never a game resource writer. */
    knowledgeStore?: import('../knowledge/knowledgeStore.js').KnowledgeStore;
    /** Host diagnostic when the durable curator store could not be opened. */
    knowledgeStoreDiagnostic?: string;
    /** Private host target attached by ToolRegistry for the current event call. */
    hostResolvedEmevdEventTarget?: HostResolvedEmevdEventTarget;
    /**
     * Host-owned automatic native-read proof boundary (T09). When present,
     * mutating tools must satisfy requireCoverage() built from the actual write
     * payload before the writer runs. Model-authored verified/proof/searchId
     * fields never populate this store.
     */
    nativeReadProofs?: NativeReadProofStore;
    /** Principal identity for proof scoping (agent run / session subject). */
    proofPrincipal?: string;
}
export interface ToolDescriptor {
    name: string;
    description: string;
    permission: ToolPermission;
    permissionLevel?: AiToolPermissionLevel;
    /** Effect and concurrency come from the same permission declaration. */
    effect?: 'read' | 'stage' | 'write' | 'rollback';
    supportsParallel?: boolean;
    /** Curator-only writes explicitly opt out; native writes default fail-closed. */
    proofPolicy?: 'native-read' | 'none';
    /**
     * Declared input contract, surfaced so callers (notably the agent loop
     * bridge) can project it into a model-facing JSON Schema. Absent means the
     * tool takes no arguments.
     */
    inputSchema?: ToolInputShape;
}
export interface ToolResult<T = unknown> {
    ok: boolean;
    /** Stable machine-facing lifecycle state; callers must not infer it from data shape. */
    state?: 'completed' | 'failed' | 'staged' | 'committed' | 'verification_failed' | 'unsupported' | 'ambiguous' | 'stale' | 'cancelled' | 'insufficient_evidence';
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
    /** Non-enumerable host-only target; never included in model-facing data. */
    __hostResolvedEmevdEventTarget?: HostResolvedEmevdEventTarget;
}
type ToolHandler = (input: unknown, context: ToolContext) => Promise<ToolResult> | ToolResult;
/**
 * Declared input contract: field name -> expected type
 * ('string' | 'number' | 'safe-integer' | 'boolean' | 'array' | 'object'; trailing '?' marks
 * the field optional; unrecognized type names pass through). Undeclared extra
 * fields are ignored — callers may attach context markers.
 *
 * Enumerations use `enum:a|b|c` (optional as `enum:a|b|c?`); arrays of those
 * values use `enum[]:a|b|c` (optional as `enum[]:a|b|c?`). Before this, a
 * field like `direction` was declared as bare `'string'` and the model was
 * told nothing about the three accepted values; a wrong value did not fail but
 * silently fell back to a default (`'sideways'` → `'both'`, `mode: 'destroy'`
 * → the session mode), so the model acted on a result it did not ask for.
 */
export type ToolInputShape = Record<string, string>;
export interface RegisteredTool extends ToolDescriptor {
    inputSchema?: ToolInputShape;
    run: ToolHandler;
}
export declare function validateToolInput(shape: ToolInputShape | undefined, input: unknown): {
    ok: true;
} | {
    ok: false;
    message: string;
};
/**
 * Project a declared ToolInputShape into the JSON Schema the model sees.
 *
 * This is deliberately a *projection* of the same declaration that
 * validateToolInput enforces at runtime, not a second hand-written schema.
 * Two independent copies would drift silently: the model would be told about
 * fields the validator rejects, or vice versa, and nothing would fail.
 *
 * `additionalProperties` stays true on purpose — validateToolInput ignores
 * undeclared extras (callers attach context markers), so advertising a closed
 * object would misdescribe the runtime contract.
 */
export declare function toolInputShapeToJsonSchema(shape: ToolInputShape | undefined): Record<string, unknown>;
/** Exposed so a test can assert every registered schema stays inside the vocabulary. */
export declare function isKnownDeclaredType(expectedType: string): boolean;
export declare class ToolRegistry {
    private readonly tools;
    register(tool: RegisteredTool): void;
    list(): ToolDescriptor[];
    run(name: string, input: unknown, context: ToolContext): Promise<ToolResult>;
}
export declare function createDefaultToolRegistry(): ToolRegistry;
export { finalizeCommittedToolResult, finalizeEmevdDslApplyResult, summarizeReferences, resolveRagCorpus, ENUM_FIELD_NORMALIZERS } from './toolRegistrySupport.js';
export type { NativePostWriteVerification } from './toolRegistrySupport.js';
