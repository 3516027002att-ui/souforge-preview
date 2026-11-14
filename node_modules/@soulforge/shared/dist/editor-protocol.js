/**
 * Unified professional-editor mutation protocol for the desktop workbench.
 * Editors emit only these mutations; main/core maps them to PatchIR.
 *
 * front-end.md 新增契约（§5.2 WorkbenchRoute、§12 Agent）追加在本文件尾部。
 * §14 DocumentStore 契约因与 legacy `EditorMutation` 重名，整体位于
 * editor-catalog.ts（见该文件头部说明）。
 */
import { expectArray, expectBoolean, expectEnum, expectNullableString, expectNumber, expectRecord, expectStableId, expectString, fail, rejectAbsolutePath, rejectUnknownFields, valueOf, decodeEditorDomainId, decodeLogicalDocumentRef } from './editor-catalog.js';
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
export const DEFERRED_PREVIEW_EDITOR_KINDS = [];
export function isDeferredPreviewEditorKind(editorKind) {
    return DEFERRED_PREVIEW_EDITOR_KINDS.includes(editorKind);
}
/**
 * §14.4 DocumentStore IPC 通道（DOCSTORE-04）。唯一声明点：main 注册与 preload
 * 暴露都引用这里的常量，改通道名时两侧同时变，不会出现一侧漂移。
 * 所有请求/响应为 named DTO（见 editor-catalog.ts 的 decoder），不保留
 * Promise<unknown> 旁路。
 */
export const EDITOR_DOCUMENT_IPC_CHANNELS = Object.freeze({
    open: 'document.open',
    get: 'document.get',
    page: 'document.page',
    readContent: 'document.readContent',
    apply: 'document.apply',
    close: 'document.close'
});
export function decodeWorkbenchRoute(value, path = 'WorkbenchRoute') {
    const r = expectRecord(value, path);
    const kind = expectEnum(valueOf(r, 'kind', path), ['ready', 'history', 'files-candidate', 'runtime-blocked', 'unsupported'], `${path}.kind`);
    switch (kind) {
        case 'ready': {
            rejectUnknownFields(r, ['kind', 'editorId', 'document', 'readOnly'], path);
            return { kind, editorId: expectString(r.editorId, `${path}.editorId`), document: decodeLogicalDocumentRef(r.document, `${path}.document`), readOnly: expectBoolean(r.readOnly, `${path}.readOnly`) };
        }
        case 'history': {
            rejectUnknownFields(r, ['kind', 'recoveryOfResourceId'], path);
            return { kind, recoveryOfResourceId: expectNullableString(r.recoveryOfResourceId, `${path}.recoveryOfResourceId`) };
        }
        case 'files-candidate': {
            rejectUnknownFields(r, ['kind', 'reasonCode'], path);
            return { kind, reasonCode: expectString(r.reasonCode, `${path}.reasonCode`) };
        }
        case 'runtime-blocked': {
            rejectUnknownFields(r, ['kind', 'editorId', 'reasonCode'], path);
            return { kind, editorId: expectString(r.editorId, `${path}.editorId`), reasonCode: expectString(r.reasonCode, `${path}.reasonCode`) };
        }
        case 'unsupported': {
            rejectUnknownFields(r, ['kind', 'reasonCode'], path);
            return { kind, reasonCode: expectString(r.reasonCode, `${path}.reasonCode`) };
        }
    }
}
export function decodeEditorSelectionContext(value, path = 'EditorSelectionContext') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['domain', 'libraryId', 'bankId', 'documentId', 'paramTableId', 'rowId', 'fieldId', 'fmgEntryId', 'eventId', 'cursor', 'revision'], path);
    const cursorValue = r.cursor;
    let cursor = null;
    if (cursorValue !== null) {
        const cr = expectRecord(cursorValue, `${path}.cursor`);
        rejectUnknownFields(cr, ['line', 'column'], `${path}.cursor`);
        cursor = { line: expectNumber(cr.line, `${path}.cursor.line`), column: expectNumber(cr.column, `${path}.cursor.column`) };
    }
    const id = (v, p) => {
        if (v === null)
            return null;
        const s = expectString(v, p);
        rejectAbsolutePath(s, p);
        return s;
    };
    return {
        domain: decodeEditorDomainId(r.domain, `${path}.domain`),
        libraryId: id(r.libraryId, `${path}.libraryId`),
        bankId: id(r.bankId, `${path}.bankId`),
        documentId: id(r.documentId, `${path}.documentId`),
        paramTableId: id(r.paramTableId, `${path}.paramTableId`),
        rowId: id(r.rowId, `${path}.rowId`),
        fieldId: id(r.fieldId, `${path}.fieldId`),
        fmgEntryId: id(r.fmgEntryId, `${path}.fmgEntryId`),
        eventId: id(r.eventId, `${path}.eventId`),
        cursor,
        revision: id(r.revision, `${path}.revision`)
    };
}
export function decodeAgentRunMode(value, path = 'AgentRunMode') {
    return expectEnum(value, ['ask', 'plan', 'edit'], path);
}
export function decodeAgentMessageDto(value, path = 'AgentMessageDto') {
    const r = expectRecord(value, path);
    const kind = expectEnum(valueOf(r, 'kind', path), ['user', 'assistant', 'tool-activity', 'approval'], `${path}.kind`);
    const id = expectStableId(r.id, `${path}.id`);
    const createdAt = expectString(r.createdAt, `${path}.createdAt`);
    switch (kind) {
        case 'user': {
            rejectUnknownFields(r, ['id', 'kind', 'text', 'contextSnapshotId', 'createdAt'], path);
            return { id, kind, text: expectString(r.text, `${path}.text`), contextSnapshotId: expectStableId(r.contextSnapshotId, `${path}.contextSnapshotId`), createdAt };
        }
        case 'assistant': {
            rejectUnknownFields(r, ['id', 'kind', 'markdown', 'streaming', 'createdAt'], path);
            return { id, kind, markdown: expectString(r.markdown, `${path}.markdown`), streaming: expectBoolean(r.streaming, `${path}.streaming`), createdAt };
        }
        case 'tool-activity': {
            rejectUnknownFields(r, ['id', 'kind', 'summary', 'status', 'createdAt'], path);
            return { id, kind, summary: expectString(r.summary, `${path}.summary`), status: expectEnum(valueOf(r, 'status', path), ['running', 'succeeded', 'failed'], `${path}.status`), createdAt };
        }
        case 'approval': {
            rejectUnknownFields(r, ['id', 'kind', 'reviewId', 'status', 'createdAt'], path);
            return { id, kind, reviewId: expectStableId(r.reviewId, `${path}.reviewId`), status: expectEnum(valueOf(r, 'status', path), ['pending', 'approved', 'rejected', 'committed', 'failed'], `${path}.status`), createdAt };
        }
    }
}
export function decodeAgentMessagePageRequest(value, path = 'AgentMessagePageRequest') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['sessionId', 'cursor', 'limit'], path);
    const limit = expectNumber(r.limit, `${path}.limit`);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(`${path}.limit`, `limit must be integer 1..100`);
    return { sessionId: expectStableId(r.sessionId, `${path}.sessionId`), cursor: expectNullableString(r.cursor, `${path}.cursor`), limit };
}
export function decodeAgentMessagePage(value, path = 'AgentMessagePage') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['items', 'nextCursor'], path);
    return {
        items: expectArray(r.items, `${path}.items`).map((v, i) => decodeAgentMessageDto(v, `${path}.items[${i}]`)),
        nextCursor: expectNullableString(r.nextCursor, `${path}.nextCursor`)
    };
}
export function decodeAgentStreamEvent(value, path = 'AgentStreamEvent') {
    const r = expectRecord(value, path);
    const kind = expectEnum(valueOf(r, 'kind', path), ['message-started', 'message-delta', 'message-finished', 'tool-updated', 'approval-updated', 'run-failed'], `${path}.kind`);
    const seq = expectNumber(r.seq, `${path}.seq`);
    if (!Number.isInteger(seq))
        fail(`${path}.seq`, `seq must be an integer`);
    const sessionId = expectStableId(r.sessionId, `${path}.sessionId`);
    switch (kind) {
        case 'message-started': {
            rejectUnknownFields(r, ['seq', 'sessionId', 'kind', 'message'], path);
            return { seq, sessionId, kind, message: decodeAgentMessageDto(r.message, `${path}.message`) };
        }
        case 'message-delta': {
            rejectUnknownFields(r, ['seq', 'sessionId', 'kind', 'messageId', 'delta'], path);
            return { seq, sessionId, kind, messageId: expectStableId(r.messageId, `${path}.messageId`), delta: expectString(r.delta, `${path}.delta`) };
        }
        case 'message-finished': {
            rejectUnknownFields(r, ['seq', 'sessionId', 'kind', 'messageId'], path);
            return { seq, sessionId, kind, messageId: expectStableId(r.messageId, `${path}.messageId`) };
        }
        case 'tool-updated':
        case 'approval-updated': {
            rejectUnknownFields(r, ['seq', 'sessionId', 'kind', 'message'], path);
            return { seq, sessionId, kind, message: decodeAgentMessageDto(r.message, `${path}.message`) };
        }
        case 'run-failed': {
            rejectUnknownFields(r, ['seq', 'sessionId', 'kind', 'reasonCode', 'retryable'], path);
            return { seq, sessionId, kind, reasonCode: expectString(r.reasonCode, `${path}.reasonCode`), retryable: expectBoolean(r.retryable, `${path}.retryable`) };
        }
    }
}
export function decodeAgentAttachmentReference(value, path = 'AgentAttachmentReference') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['token', 'mediaType', 'byteLength', 'expiresAt'], path);
    const token = expectString(r.token, `${path}.token`);
    rejectAbsolutePath(token, `${path}.token`);
    return {
        token,
        mediaType: expectEnum(valueOf(r, 'mediaType', path), ['image/png', 'image/jpeg', 'image/webp', 'text/plain'], `${path}.mediaType`),
        byteLength: expectNumber(r.byteLength, `${path}.byteLength`),
        expiresAt: expectString(r.expiresAt, `${path}.expiresAt`)
    };
}
export function decodeAgentResourceReference(value, path = 'AgentResourceReference') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['token', 'domain', 'label', 'expiresAt'], path);
    const token = expectString(r.token, `${path}.token`);
    rejectAbsolutePath(token, `${path}.token`);
    return { token, domain: decodeEditorDomainId(r.domain, `${path}.domain`), label: expectString(r.label, `${path}.label`), expiresAt: expectString(r.expiresAt, `${path}.expiresAt`) };
}
export function decodeSubmitAgentRunRequest(value, path = 'SubmitAgentRunRequest') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['sessionId', 'prompt', 'mode', 'modelConfigId', 'contextSnapshotId', 'attachments', 'resources'], path);
    const prompt = expectString(r.prompt, `${path}.prompt`);
    const promptUnits = prompt.length;
    if (promptUnits < 1 || promptUnits > 65536)
        fail(`${path}.prompt`, `prompt must be 1..65536 UTF-16 code units`);
    const attachments = expectArray(r.attachments, `${path}.attachments`).map((v, i) => decodeAgentAttachmentReference(v, `${path}.attachments[${i}]`));
    if (attachments.length > 8)
        fail(`${path}.attachments`, `at most 8 attachments`);
    const resources = expectArray(r.resources, `${path}.resources`).map((v, i) => decodeAgentResourceReference(v, `${path}.resources[${i}]`));
    if (resources.length > 16)
        fail(`${path}.resources`, `at most 16 resources`);
    return {
        sessionId: expectStableId(r.sessionId, `${path}.sessionId`),
        prompt,
        mode: decodeAgentRunMode(r.mode, `${path}.mode`),
        modelConfigId: expectStableId(r.modelConfigId, `${path}.modelConfigId`),
        contextSnapshotId: expectStableId(r.contextSnapshotId, `${path}.contextSnapshotId`),
        attachments,
        resources
    };
}
export function decodeStopAgentRunRequest(value, path = 'StopAgentRunRequest') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['sessionId', 'runId'], path);
    return { sessionId: expectStableId(r.sessionId, `${path}.sessionId`), runId: expectStableId(r.runId, `${path}.runId`) };
}
export function decodeDecideAgentApprovalRequest(value, path = 'DecideAgentApprovalRequest') {
    const r = expectRecord(value, path);
    rejectUnknownFields(r, ['sessionId', 'reviewId', 'expectedRevision', 'decision'], path);
    return {
        sessionId: expectStableId(r.sessionId, `${path}.sessionId`),
        reviewId: expectStableId(r.reviewId, `${path}.reviewId`),
        expectedRevision: expectString(r.expectedRevision, `${path}.expectedRevision`),
        decision: expectEnum(valueOf(r, 'decision', path), ['approve-and-commit', 'reject'], `${path}.decision`)
    };
}
/**
 * §12.11 固定允许转换；其他组合必须返回原状态并记录开发诊断。
 * 不允许用多个互不约束的 boolean 表示同一状态机。
 */
export function reduceAgentComposer(state, event) {
    const invalid = (message) => ({
        state,
        diagnostic: { code: 'ILLEGAL_TRANSITION', message, eventType: event.type, stateKind: state.kind }
    });
    switch (event.type) {
        case 'PROMPT_CHANGED': {
            if (state.kind === 'idle')
                return { state: { kind: 'composing', prompt: event.prompt }, diagnostic: null };
            if (state.kind === 'composing')
                return { state: { kind: 'composing', prompt: event.prompt }, diagnostic: null };
            return invalid(`PROMPT_CHANGED not allowed from ${state.kind}`);
        }
        case 'SUBMIT': {
            if (state.kind !== 'composing')
                return invalid(`SUBMIT requires composing, got ${state.kind}`);
            return { state: { kind: 'submitting', runId: event.runId }, diagnostic: null };
        }
        case 'STREAM_STARTED': {
            if (state.kind !== 'submitting')
                return invalid(`STREAM_STARTED requires submitting, got ${state.kind}`);
            return { state: { kind: 'streaming', runId: event.runId }, diagnostic: null };
        }
        case 'DELTA': {
            if (state.kind !== 'streaming' && state.kind !== 'tool-running') {
                return invalid(`DELTA requires streaming/tool-running, got ${state.kind}`);
            }
            return { state, diagnostic: null };
        }
        case 'TOOL_STARTED': {
            if (state.kind !== 'streaming')
                return invalid(`TOOL_STARTED requires streaming, got ${state.kind}`);
            return { state: { kind: 'tool-running', runId: event.runId, toolActivityId: event.toolActivityId }, diagnostic: null };
        }
        case 'TOOL_FINISHED': {
            if (state.kind !== 'tool-running')
                return invalid(`TOOL_FINISHED requires tool-running, got ${state.kind}`);
            return { state: { kind: 'streaming', runId: event.runId }, diagnostic: null };
        }
        case 'APPROVAL_REQUIRED': {
            if (state.kind !== 'streaming' && state.kind !== 'tool-running') {
                return invalid(`APPROVAL_REQUIRED requires streaming/tool-running, got ${state.kind}`);
            }
            return { state: { kind: 'awaiting-approval', runId: event.runId, reviewId: event.reviewId }, diagnostic: null };
        }
        case 'APPROVE': {
            if (state.kind !== 'awaiting-approval')
                return invalid(`APPROVE requires awaiting-approval, got ${state.kind}`);
            return { state: { kind: 'committing', runId: event.runId, reviewId: event.reviewId }, diagnostic: null };
        }
        case 'REJECT': {
            if (state.kind !== 'awaiting-approval')
                return invalid(`REJECT requires awaiting-approval, got ${state.kind}`);
            return { state: { kind: 'idle', prompt: '' }, diagnostic: null };
        }
        case 'COMMIT_FINISHED': {
            if (state.kind !== 'committing')
                return invalid(`COMMIT_FINISHED requires committing, got ${state.kind}`);
            return { state: { kind: 'verifying', runId: event.runId, reviewId: event.reviewId }, diagnostic: null };
        }
        case 'VERIFY_FINISHED': {
            if (state.kind !== 'verifying')
                return invalid(`VERIFY_FINISHED requires verifying, got ${state.kind}`);
            return { state: { kind: 'idle', prompt: '' }, diagnostic: null };
        }
        case 'STREAM_FINISHED': {
            if (state.kind !== 'streaming')
                return invalid(`STREAM_FINISHED requires streaming, got ${state.kind}`);
            return { state: { kind: 'idle', prompt: '' }, diagnostic: null };
        }
        case 'FAIL': {
            const active = ['submitting', 'streaming', 'tool-running', 'awaiting-approval', 'committing', 'verifying'];
            if (!active.includes(state.kind))
                return invalid(`FAIL requires active run, got ${state.kind}`);
            return { state: { kind: 'failed', prompt: event.prompt, reasonCode: event.reasonCode }, diagnostic: null };
        }
        case 'STOP': {
            const active = ['submitting', 'streaming', 'tool-running', 'awaiting-approval', 'committing', 'verifying'];
            if (!active.includes(state.kind))
                return invalid(`STOP requires active run, got ${state.kind}`);
            return { state: { kind: 'idle', prompt: '' }, diagnostic: null };
        }
        case 'RESET': {
            if (state.kind !== 'failed')
                return invalid(`RESET requires failed, got ${state.kind}`);
            return { state: { kind: 'idle', prompt: '' }, diagnostic: null };
        }
    }
}
//# sourceMappingURL=editor-protocol.js.map