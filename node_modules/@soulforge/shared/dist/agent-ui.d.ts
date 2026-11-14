/**
 * AGENT-60C — Agent 语义上下文、opaque 引用与流式消息的 renderer 安全纯逻辑。
 *
 * 本模块只放「不依赖 DOM / IPC 的判定」，renderer 侧单点 import，main 侧复用：
 *
 *  - §12.8 EditorSelectionContext 快照冻结：发送时冻结，切换编辑器不改变已发送目标；
 *  - renderer 安全白名单：绝对路径、raw parser / Hex dump 不得进入 DTO 或 DOM；
 *  - 跨 sender 的 opaque 引用 token（附件 / 资源）：签发、解析、跨 sender 拒绝；
 *  - §12.11 严格 event seq：重复 / 倒序丢弃并记结构化诊断；
 *  - message pages（运输分页）：窗口、游标、追加去重；消息全量保留——
 *    不因条数上限丢弃更早消息（问题 5：显示不设限）；
 *  - scroll threshold：贴底自动滚动；
 *  - resume：承接会话时从尾部回放。
 *
 * §12.11 的 named DTO 类型与 runtime decoder 位于 editor-protocol.ts，本模块重新
 * 导出供 renderer 单点引用，并补上 UI 层判定。composer 状态机（reduceAgentComposer）
 * 已在 editor-protocol.ts，不在此重复。
 */
import { type AgentContextSnapshot, type AgentMessageDto, type AgentMessagePageRequest, type AgentStreamEvent, type EditorSelectionContext } from './editor-protocol.js';
export type { EditorSelectionContext, AgentContextSnapshot, AgentMessagePageRequest, AgentMessagePage, AgentMessageDto, AgentStreamEvent, AgentAttachmentReference, AgentResourceReference, SubmitAgentRunRequest, StopAgentRunRequest, DecideAgentApprovalRequest, AgentRunMode } from './editor-protocol.js';
export { decodeEditorSelectionContext, decodeAgentRunMode, decodeAgentMessageDto, decodeAgentMessagePageRequest, decodeAgentMessagePage, decodeAgentStreamEvent, decodeAgentAttachmentReference, decodeAgentResourceReference, decodeSubmitAgentRunRequest, decodeStopAgentRunRequest, decodeDecideAgentApprovalRequest } from './editor-protocol.js';
export interface FreezeAgentSelectionSnapshotOptions {
    /** 显式 snapshotId（测试注入；缺省随机生成）。 */
    readonly snapshotId?: string;
    /** 显式创建时间（测试注入；缺省 now）。 */
    readonly createdAt?: string;
}
/**
 * 发送时冻结上下文快照（§12.8「发送时冻结上下文快照，运行中切换编辑器不能改变
 * 任务目标」）。返回的 snapshot 与 selection 均深度冻结；调用方之后改原 selection
 * 对象也不会改变已发送快照。
 */
export declare function freezeAgentSelectionSnapshot(selection: EditorSelectionContext, options?: FreezeAgentSelectionSnapshotOptions): AgentContextSnapshot;
/** 快照与其 selection 是否已冻结（负向测试断言「切换编辑器不改变已发送快照」的依据）。 */
export declare function isSelectionSnapshotFrozen(snapshot: AgentContextSnapshot): boolean;
/** §12.11 AgentContextSnapshot 的 runtime decoder（snapshotId/selection/createdAt）。 */
export declare function decodeAgentContextSnapshot(value: unknown, path?: string): AgentContextSnapshot;
export type AgentSelectionIssueCode = 'AGENT_SELECTION_ABSOLUTE_PATH' | 'AGENT_SELECTION_RAW_PARSER' | 'AGENT_SELECTION_HEX_DUMP';
export interface AgentSelectionIssue {
    readonly code: AgentSelectionIssueCode;
    readonly path: string;
    readonly message: string;
}
/**
 * 选区 renderer 安全白名单。返回结构化诊断列表；空数组 = 安全。
 *
 * 负向判定（§19.5「Evidence、Hex、parser dump、绝对路径不进入默认 editor/Agent DOM」）：
 * 任一字符串字段携带绝对路径、raw parser 标记或整行 hex dump 都会被拒。
 */
export declare function selectionRendererSafetyIssues(selection: EditorSelectionContext): readonly AgentSelectionIssue[];
export declare function isSelectionRendererSafe(selection: EditorSelectionContext): boolean;
/** §12.8 无选区时的固定展示文案（renderer 侧）。 */
export declare const AGENT_NO_SELECTION_LABEL = "\u672A\u9009\u62E9\u903B\u8F91\u8D44\u6E90";
/**
 * 选区的 opaque 展示摘要：只暴露逻辑层级，不携带任何路径。缺省时给固定空态文案。
 */
export declare function agentSelectionSummary(selection: EditorSelectionContext | null): string;
export type AgentReferenceTokenKind = 'attachment' | 'resource' | 'citation';
/** 引用 token 默认 TTL：30 分钟。 */
export declare const AGENT_REFERENCE_TOKEN_TTL_MS: number;
export interface AgentReferenceTokenPayload {
    readonly v: 1;
    readonly kind: AgentReferenceTokenKind;
    readonly tokenId: string;
    /** 签发者作用域（main 侧 = webContents.id；跑批场景 = sessionId）。 */
    readonly ownerId: string;
    /** 过期 epoch ms。 */
    readonly exp: number;
    readonly domain?: string;
    readonly label?: string;
    readonly byteLength?: number;
    readonly mediaType?: string;
}
export interface MintAgentReferenceTokenInput {
    readonly kind: AgentReferenceTokenKind;
    readonly tokenId: string;
    readonly ownerId: string;
    readonly ttlMs?: number;
    readonly now?: number;
    readonly domain?: string;
    readonly label?: string;
    readonly byteLength?: number;
    readonly mediaType?: string;
}
/**
 * 签发 opaque 引用 token。token 只携带 tokenId / ownerId / 过期 / 逻辑元数据，
 * 不携带任何路径。真正的防伪由 main 侧注册表承担——renderer 永远不调用本函数。
 */
export declare function mintAgentReferenceToken(input: MintAgentReferenceTokenInput): string;
export declare class AgentReferenceTokenError extends Error {
    readonly code: 'AGENT_TOKEN_MALFORMED';
    constructor(message: string);
}
/** 解析 token 载荷（不含任何路径字段）。格式非法抛 AgentReferenceTokenError。 */
export declare function parseAgentReferenceToken(token: string): AgentReferenceTokenPayload;
export type AgentReferenceScopeValidation = {
    ok: true;
    payload: AgentReferenceTokenPayload;
} | {
    ok: false;
    code: 'AGENT_TOKEN_MALFORMED' | 'AGENT_TOKEN_EXPIRED' | 'AGENT_TOKEN_SENDER_MISMATCH';
    message: string;
};
/**
 * 跨 sender token / handle 拒绝（§12.11「附件和资源引用只使用 main-issued token」）。
 * ownerId 与 token 签发作用域不一致即拒绝——A sender 签发的 token 不能由 B 提交。
 */
export declare function validateAgentReferenceScope(token: string, ownerId: string, nowMs?: number): AgentReferenceScopeValidation;
/** token 的过期 ISO 时间（main 侧签发引用对象时与 token 内的 exp 保持同一口径）。 */
export declare function agentReferenceExpiresAt(now?: number, ttlMs?: number): string;
export interface AgentStreamSeqDiagnostic {
    readonly code: 'DUPLICATE_SEQ' | 'REVERSED_SEQ';
    readonly sessionId: string;
    readonly seq: number;
    readonly lastSeq: number;
}
export interface AgentStreamSeqState {
    readonly lastSeqBySession: ReadonlyMap<string, number>;
    readonly diagnostics: readonly AgentStreamSeqDiagnostic[];
}
export type AgentStreamSeqVerdict = {
    accepted: true;
} | {
    accepted: false;
    reason: 'DUPLICATE_SEQ' | 'REVERSED_SEQ';
};
export declare function createAgentStreamSeqState(): AgentStreamSeqState;
/**
 * 严格递增 seq 判定：`seq` 必须大于该 session 的上一条已接受 seq。
 * 重复 / 倒序丢弃并追加结构化诊断；accepted 的调用返回包含新 lastSeq 的状态。
 */
export declare function applyAgentStreamSeq(state: AgentStreamSeqState, event: {
    readonly sessionId: string;
    readonly seq: number;
}): {
    readonly state: AgentStreamSeqState;
    readonly verdict: AgentStreamSeqVerdict;
};
export interface AgentStreamSeqTracker {
    accept(event: {
        readonly sessionId: string;
        readonly seq: number;
    }): boolean;
    readonly lastSeqBySession: ReadonlyMap<string, number>;
    readonly diagnostics: readonly AgentStreamSeqDiagnostic[];
}
/** 可变便捷封装（UI 侧用）；纯逻辑本体是 applyAgentStreamSeq。 */
export declare function createAgentStreamSeqTracker(): AgentStreamSeqTracker;
/** §12.11 limit 默认值（decoder 限制 1..100，用于运输分页请求）。 */
export declare const AGENT_MESSAGE_PAGE_SIZE = 50;
export declare function clampAgentMessagePageLimit(limit: number): number;
export declare function formatAgentMessageCursor(index: number): string;
/** 解析 `msg:<index>` 游标；格式非法返回 null。 */
export declare function parseAgentMessageCursor(cursor: string): number | null;
export interface AgentMessagePageSlice {
    readonly items: readonly AgentMessageDto[];
    readonly nextCursor: string | null;
}
/** 从游标处取一页（§12.11 AgentMessagePageRequest/AgentMessagePage 的纯逻辑）。 */
export declare function sliceAgentMessagePage(messages: readonly AgentMessageDto[], cursor: string | null, limit: number): AgentMessagePageSlice;
export interface AgentMessageWindow {
    readonly items: readonly AgentMessageDto[];
    readonly startIndex: number;
    readonly endIndex: number;
    readonly hasOlder: boolean;
    readonly hasNewer: boolean;
}
/** 以窗口 [startIndex, startIndex+limit) 渲染的有界窗口。 */
export declare function agentMessageWindow(messages: readonly AgentMessageDto[], startIndex: number, limit: number): AgentMessageWindow;
/** 尾部窗口（初始渲染 / resume 回放）。 */
export declare function agentMessageTail(messages: readonly AgentMessageDto[], limit?: number): AgentMessageWindow;
/** 「加载更早」游标：指向当前窗口再往前一页的位置；无更早消息时为 null。 */
export declare function agentOlderCursor(window: AgentMessageWindow, limit: number): string | null;
export interface AppendAgentMessagePageResult {
    readonly messages: readonly AgentMessageDto[];
    readonly added: number;
    readonly replaced: number;
}
/**
 * 流式增量合并：按 id 去重（同 id 视为 streaming 更新替换旧值），新消息追加到尾部。
 * 消息**全量保留**，不因条数上限丢弃更早消息（问题 5：显示不设限）。
 */
export declare function appendAgentMessagePage(prev: readonly AgentMessageDto[], incoming: readonly AgentMessageDto[]): AppendAgentMessagePageResult;
/** §12.11 AgentMessagePageRequest 的构造（limit 收敛到 1..100）。 */
export declare function buildAgentMessagePageRequest(sessionId: string, cursor: string | null, limit: number): AgentMessagePageRequest;
export interface AgentScrollMetrics {
    readonly scrollTop: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
}
/** 距底部不足该值视为「贴底」，自动滚动到底部。 */
export declare const AGENT_SCROLL_THRESHOLD_PX = 48;
export declare function shouldAgentAutoScroll(metrics: AgentScrollMetrics, threshold?: number): boolean;
export declare function isAgentScrollNearTop(metrics: AgentScrollMetrics, threshold?: number): boolean;
/** 承接会话时回放的尾部消息条数（与 ai.agent.session.load 的 messagesPage 尾部一致）。 */
export declare const AGENT_RESUME_TAIL_MESSAGES = 20;
export declare function agentResumeStartIndex(total: number, tail?: number): number;
export declare function buildAgentResumePageRequest(sessionId: string, totalMessages: number, limit?: number): AgentMessagePageRequest;
export interface AgentStreamAssemblyResult {
    readonly messages: readonly AgentMessageDto[];
    readonly dropped: readonly AgentStreamSeqDiagnostic[];
    readonly lastSeqBySession: ReadonlyMap<string, number>;
}
/**
 * 把一段 §12.11 AgentStreamEvent 装配成有序消息列表：
 *  - 严格 seq：重复 / 倒序事件丢弃并记诊断（不重放）；
 *  - 同 id 增量更新（delta 追加、finished 关流、tool/approval 替换）；
 *  - 消息全量保留（不因条数上限丢弃更早消息）。
 */
export declare function reduceAgentStreamToMessages(events: readonly AgentStreamEvent[]): AgentStreamAssemblyResult;
