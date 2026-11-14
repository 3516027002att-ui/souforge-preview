import type { DeferredPreviewEditorKind, EditorKind, EditorMutationKind } from '@soulforge/shared';
export type EditorDocumentAuthorityContract = 'raw-byte-document' | 'bridge-native-document' | 'text-document';
export type EditorScaleAccess = 'pagination' | 'virtualization' | 'chunking' | 'streaming' | 'bounded-window' | 'eager' | 'none';
/**
 * Clamp a requested page into [0, pageCount) and return the served window.
 * Shared by every paginated editor access channel in the desktop main process
 * (`apps/desktop/src/main/ipc.ts`) and by the bounded-access acceptance smoke
 * (`runEditorBoundedAccessSmoke.ts`) so both sides always apply the same
 * windowing semantics (hard constraint 17). Out-of-range navigation fails
 * safely to the nearest valid page instead of returning empty pages.
 */
export declare function normalizePageWindow(total: number, requestedPage: number, pageSize: number): {
    page: number;
    pageCount: number;
    offset: number;
    size: number;
};
/**
 * 当前编辑器能力清单中的 editor id。该类型只描述能力契约投影，
 * 不等同于 release Gate 已通过；真实 native authority、revision 校验、
 * Patch Engine 提交和 release 验收仍由各自运行链路负责。
 */
export type ProposedReleaseEditorId = 'bnd4' | 'fmg' | 'param' | 'emevd' | 'script' | 'tae' | 'esd';
/**
 * 旧版 deferred-preview 字段的兼容形状。
 *
 * 当前能力契约不再用它限制 TAE/ESD；所有当前编辑器均以
 * `deferredPreview: null` 表示正常能力路径。保留该结构只为兼容旧的
 * renderer/诊断读取方，不能替代 `releaseWriteEnabled`、native authority、
 * revision 或 Patch Engine 门槛。
 */
export type DeferredPreviewEditorId = DeferredPreviewEditorKind;
export interface EditorDeferredPreviewContract {
    /** 仅保留旧协议字段，当前能力契约不会创建此对象。 */
    deferredToRelease: string;
    readOnly: true;
    markedAsPreview: true;
    countedAsReleaseEditor: false;
}
export interface EditorCapabilityContract {
    editorKind: EditorKind;
    proposedReleaseEditorId: ProposedReleaseEditorId | null;
    proposalOrder: number | null;
    documentAuthority: EditorDocumentAuthorityContract;
    /**
     * 已接线的 typed mutation 种类。它们描述当前实现能力；是否允许执行
     * 仍由 `releaseWriteEnabled` 与 native authority、revision、Patch Engine
     * 写链共同决定。
     */
    mutationKinds: readonly EditorMutationKind[];
    /**
     * 当前能力契约是否允许该编辑器进入 typed write path。该标志不是绕过
     * Patch Engine、native writer、revision/fail-closed 或 release Gate 的授权。
     */
    releaseWriteEnabled: boolean;
    /** 旧版兼容字段；当前可开发编辑器必须为 null。 */
    deferredPreview: EditorDeferredPreviewContract | null;
    revisionContract: 'monotonic-reject-stale';
    scalePrimitives: readonly EditorScaleAccess[];
    scaleAccess: EditorScaleAccess;
    scaleDimensions: readonly string[];
    contractSources: readonly string[];
}
/**
 * Single source for the editor capabilities enforced by EditorDocumentStore and
 * projected into the editor inventory. Scale access describes the current
 * implementation, including known non-release-safe bounded/eager views; it does
 * not by itself assert native verification or release completion.
 */
export declare const EDITOR_CAPABILITY_CONTRACTS: Readonly<Record<EditorKind, EditorCapabilityContract>>;
export declare function editorAllowsMutation(editorKind: EditorKind, mutationKind: EditorMutationKind): boolean;
/**
 * 兼容旧 renderer/IPC 的延期查询。当前契约不再登记 deferred editor，
 * 因此正常返回 false；它不是当前写入能力的权威判断。
 */
export declare function isDeferredPreviewEditor(editorKind: EditorKind): boolean;
/**
 * 兼容旧调用方的延期清单。过渡期没有被该投影屏蔽的 editor kind，
 * 所以当前结果为空；写入仍由能力契约和统一安全写链决定。
 */
export declare function listDeferredPreviewEditors(): readonly EditorKind[];
