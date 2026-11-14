/**
 * Unified professional-editor mutation protocol for the desktop workbench.
 * Editors emit only these mutations; main/core maps them to PatchIR.
 *
 * front-end.md 新增契约（§5.2 WorkbenchRoute、§12 Agent）追加在本文件尾部。
 * §14 DocumentStore 契约因与 legacy `EditorMutation` 重名，整体位于
 * editor-catalog.ts（见该文件头部说明）。
 */
import type { EditorDomainId, LogicalDocumentRef } from './editor-catalog.js';
export type EditorKind = 'hex' | 'bnd4' | 'fmg' | 'param' | 'emevd' | 'msb' | 'tae' | 'esd' | 'script' | 'flver' | 'text' | 'raw';
export type EditorMutationKind = 'fmg_entry_upsert' | 'fmg_entry_delete' | 'fmg_entry_add' | 'param_row_upsert' | 'param_row_delete' | 'param_field_set' | 'emevd_set_rest_behavior' | 'emevd_update_id' | 'msb_set_part_position' | 'msb_set_part_transform' | 'flver_material_slot_set'
/** 当前 TAE/ESD writer 使用 editor-catalog 的 canonical mutation id。 */
 | 'tae-event-upsert' | 'behavior-transition-upsert';
/**
 * 旧版 deferred-preview 投影的兼容出口。
 *
 * 过渡期不再通过此列表限制 TAE/ESD/ACTION 开发；当前列表刻意
 * 为空，因此 renderer 不会因历史 deferred 标记隐藏现有 writer 或编辑器。
 * 该兼容出口不授予 native authority，也不替代 Patch Engine、revision 或
 * fail-closed 校验。
 *
 * 放在 shared 而非 core 是为了让 renderer 继续安全读取兼容投影；当前
 * editor capability contract 才是 core 侧写入能力的单一来源。
 */
export declare const DEFERRED_PREVIEW_EDITOR_KINDS: readonly [];
/**
 * 历史兼容类型。运行时投影已为空，但保留旧版 tae/esd 取值以避免旧
 * renderer/诊断代码在迁移期间失去类型信息；`isDeferredPreviewEditorKind`
 * 仍以当前空数组为实际判断来源。
 */
export type DeferredPreviewEditorKind = 'tae' | 'esd';
export declare function isDeferredPreviewEditorKind(editorKind: EditorKind): editorKind is DeferredPreviewEditorKind;
export interface EditorDocumentRef {
    documentId: string;
    editorKind: EditorKind;
    resourceUri: string;
    /** Revision monotically increases on each accepted mutation. */
    revision: number;
    title: string;
}
/**
 * @deprecated 旧 patchIR 计划形态。§14.4 的 `EditorMutation`
 * （kebab-case discriminated union）已移至 editor-catalog.ts 并取代本类型；
 * 本类型仅保留给迁移前仍在使用的 core 调用方。
 */
export interface LegacyEditorMutation {
    mutationId: string;
    documentId: string;
    kind: EditorMutationKind;
    resourceUri: string;
    baseRevision: number;
    payload: Record<string, unknown>;
    createdAt: string;
}
export interface EditorValidationIssue {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    resourceUri?: string;
}
export interface EditorMutationBatch {
    batchId: string;
    documentId: string;
    mutations: LegacyEditorMutation[];
    /** Only PatchIR-bound batches may be committed. */
    requiresPatchEngine: true;
}
/**
 * One page of FMG entries served by the paginated editor access channel
 * (`resource.readFmgPage`). The renderer only ever receives a bounded page
 * plus navigation metadata; the complete document is assembled in main
 * (hard constraint 17).
 */
export interface FmgEntryPage {
    ok: boolean;
    sourceUri: string;
    sourceHash: string | null;
    /** Total entry count across all pages (after the active query filter). */
    entryCount: number;
    /** Largest entry id observed in the whole document (safe id for add). */
    maxId: number;
    page: number;
    pageSize: number;
    pageCount: number;
    entries: Array<{
        id: number;
        text: string;
    }>;
    authority?: string;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
/**
 * One page of PARAM rows served by the paginated editor access channel
 * (`resource.readParamPage`). Rows carry the full row bytes (base64) so the
 * renderer can duplicate rows and drive field-level editing without holding
 * the whole document.
 */
export interface ParamRowPage {
    ok: boolean;
    sourceUri: string;
    sourceHash: string | null;
    typeName?: string;
    rowDataSize?: number;
    /** Total row count across all pages (after the active query filter). */
    rowCount: number;
    page: number;
    pageSize: number;
    pageCount: number;
    rows: Array<{
        /** Physical row ordinal in the native PARAM directory; IDs are not unique. */
        rowIndex: number;
        id: number;
        dataHash?: string;
        name?: string;
        dataBase64?: string;
        dataHexPreview?: string;
    }>;
    /** True when the native document exposes more rows than this channel covers. */
    rowsTruncated: boolean;
    authority?: string;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export type WorkbenchRoute = {
    kind: 'ready';
    editorId: string;
    document: LogicalDocumentRef;
    readOnly: boolean;
} | {
    kind: 'history';
    recoveryOfResourceId: string | null;
} | {
    kind: 'files-candidate';
    reasonCode: string;
} | {
    kind: 'runtime-blocked';
    editorId: string;
    reasonCode: string;
} | {
    kind: 'unsupported';
    reasonCode: string;
};
/**
 * §14.4 DocumentStore IPC 通道（DOCSTORE-04）。唯一声明点：main 注册与 preload
 * 暴露都引用这里的常量，改通道名时两侧同时变，不会出现一侧漂移。
 * 所有请求/响应为 named DTO（见 editor-catalog.ts 的 decoder），不保留
 * Promise<unknown> 旁路。
 */
export declare const EDITOR_DOCUMENT_IPC_CHANNELS: Readonly<{
    readonly open: "document.open";
    readonly get: "document.get";
    readonly page: "document.page";
    readonly readContent: "document.readContent";
    readonly apply: "document.apply";
    readonly close: "document.close";
}>;
export type EditorDocumentIpcChannel = typeof EDITOR_DOCUMENT_IPC_CHANNELS[keyof typeof EDITOR_DOCUMENT_IPC_CHANNELS];
export declare function decodeWorkbenchRoute(value: unknown, path?: string): WorkbenchRoute;
export interface EditorSelectionContext {
    readonly domain: EditorDomainId;
    readonly libraryId: string | null;
    readonly bankId: string | null;
    readonly documentId: string | null;
    readonly paramTableId: string | null;
    readonly rowId: string | null;
    readonly fieldId: string | null;
    readonly fmgEntryId: string | null;
    readonly eventId: string | null;
    readonly cursor: {
        line: number;
        column: number;
    } | null;
    readonly revision: string | null;
}
export declare function decodeEditorSelectionContext(value: unknown, path?: string): EditorSelectionContext;
export type AgentRunMode = 'ask' | 'plan' | 'edit';
export interface AgentContextSnapshot {
    readonly snapshotId: string;
    readonly selection: EditorSelectionContext;
    readonly createdAt: string;
}
export interface AgentMessagePageRequest {
    readonly sessionId: string;
    readonly cursor: string | null;
    readonly limit: number;
}
export interface AgentMessagePage {
    readonly items: readonly AgentMessageDto[];
    readonly nextCursor: string | null;
}
export type AgentMessageDto = {
    id: string;
    kind: 'user';
    text: string;
    contextSnapshotId: string;
    createdAt: string;
} | {
    id: string;
    kind: 'assistant';
    markdown: string;
    streaming: boolean;
    createdAt: string;
} | {
    id: string;
    kind: 'tool-activity';
    summary: string;
    status: 'running' | 'succeeded' | 'failed';
    createdAt: string;
} | {
    id: string;
    kind: 'approval';
    reviewId: string;
    status: 'pending' | 'approved' | 'rejected' | 'committed' | 'failed';
    createdAt: string;
};
export type AgentStreamEvent = {
    seq: number;
    sessionId: string;
    kind: 'message-started';
    message: AgentMessageDto;
} | {
    seq: number;
    sessionId: string;
    kind: 'message-delta';
    messageId: string;
    delta: string;
} | {
    seq: number;
    sessionId: string;
    kind: 'message-finished';
    messageId: string;
} | {
    seq: number;
    sessionId: string;
    kind: 'tool-updated';
    message: AgentMessageDto;
} | {
    seq: number;
    sessionId: string;
    kind: 'approval-updated';
    message: AgentMessageDto;
} | {
    seq: number;
    sessionId: string;
    kind: 'run-failed';
    reasonCode: string;
    retryable: boolean;
};
export type AgentAttachmentMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'text/plain';
export interface AgentAttachmentReference {
    readonly token: string;
    readonly mediaType: AgentAttachmentMediaType;
    readonly byteLength: number;
    readonly expiresAt: string;
}
export interface AgentResourceReference {
    readonly token: string;
    readonly domain: EditorDomainId;
    readonly label: string;
    readonly expiresAt: string;
}
export interface SubmitAgentRunRequest {
    readonly sessionId: string;
    readonly prompt: string;
    readonly mode: AgentRunMode;
    readonly modelConfigId: string;
    readonly contextSnapshotId: string;
    readonly attachments: readonly AgentAttachmentReference[];
    readonly resources: readonly AgentResourceReference[];
}
export interface StopAgentRunRequest {
    readonly sessionId: string;
    readonly runId: string;
}
export interface DecideAgentApprovalRequest {
    readonly sessionId: string;
    readonly reviewId: string;
    readonly expectedRevision: string;
    readonly decision: 'approve-and-commit' | 'reject';
}
export declare function decodeAgentRunMode(value: unknown, path?: string): AgentRunMode;
export declare function decodeAgentMessageDto(value: unknown, path?: string): AgentMessageDto;
export declare function decodeAgentMessagePageRequest(value: unknown, path?: string): AgentMessagePageRequest;
export declare function decodeAgentMessagePage(value: unknown, path?: string): AgentMessagePage;
export declare function decodeAgentStreamEvent(value: unknown, path?: string): AgentStreamEvent;
export declare function decodeAgentAttachmentReference(value: unknown, path?: string): AgentAttachmentReference;
export declare function decodeAgentResourceReference(value: unknown, path?: string): AgentResourceReference;
export declare function decodeSubmitAgentRunRequest(value: unknown, path?: string): SubmitAgentRunRequest;
export declare function decodeStopAgentRunRequest(value: unknown, path?: string): StopAgentRunRequest;
export declare function decodeDecideAgentApprovalRequest(value: unknown, path?: string): DecideAgentApprovalRequest;
export type AgentComposerState = {
    kind: 'idle';
    prompt: '';
} | {
    kind: 'composing';
    prompt: string;
} | {
    kind: 'submitting';
    runId: string;
} | {
    kind: 'streaming';
    runId: string;
} | {
    kind: 'tool-running';
    runId: string;
    toolActivityId: string;
} | {
    kind: 'awaiting-approval';
    runId: string;
    reviewId: string;
} | {
    kind: 'committing';
    runId: string;
    reviewId: string;
} | {
    kind: 'verifying';
    runId: string;
    reviewId: string;
} | {
    kind: 'failed';
    prompt: string;
    reasonCode: string;
};
export type AgentComposerEvent = {
    type: 'PROMPT_CHANGED';
    prompt: string;
} | {
    type: 'SUBMIT';
    runId: string;
} | {
    type: 'STREAM_STARTED';
    runId: string;
} | {
    type: 'DELTA';
    runId: string;
} | {
    type: 'TOOL_STARTED';
    runId: string;
    toolActivityId: string;
} | {
    type: 'TOOL_FINISHED';
    runId: string;
} | {
    type: 'APPROVAL_REQUIRED';
    runId: string;
    reviewId: string;
} | {
    type: 'APPROVE';
    runId: string;
    reviewId: string;
} | {
    type: 'REJECT';
    runId: string;
    reviewId: string;
} | {
    type: 'COMMIT_FINISHED';
    runId: string;
    reviewId: string;
} | {
    type: 'VERIFY_FINISHED';
    runId: string;
    reviewId: string;
} | {
    type: 'STREAM_FINISHED';
    runId: string;
} | {
    type: 'FAIL';
    prompt: string;
    reasonCode: string;
} | {
    type: 'STOP';
    runId: string;
} | {
    type: 'RESET';
};
export type AgentComposerDiagnostic = {
    code: string;
    message: string;
    eventType: AgentComposerEvent['type'];
    stateKind: AgentComposerState['kind'];
};
export interface ReduceAgentComposerResult {
    readonly state: AgentComposerState;
    /** 非法转换时的开发诊断；合法转换时为 null。 */
    readonly diagnostic: AgentComposerDiagnostic | null;
}
/**
 * §12.11 固定允许转换；其他组合必须返回原状态并记录开发诊断。
 * 不允许用多个互不约束的 boolean 表示同一状态机。
 */
export declare function reduceAgentComposer(state: AgentComposerState, event: AgentComposerEvent): ReduceAgentComposerResult;
