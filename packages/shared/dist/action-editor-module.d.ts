/**
 * ACTION 编辑器共享模型。
 *
 * 这是对 TAE-DX/DSAnimStudio 信息架构的干净实现：动作目录按 native TAE
 * child 的动作族归组，事件图使用动画自己的事件下标，预览层只消费本模块
 * 产出的纯数据。这里不读文件、不创建 renderer 对象，也不猜测 native identity。
 */
import { type TaeDiagnostic, type TaeAnimationWire, type TaeTimelineEventRow, type TaeDocument } from './animation-editor.js';
import { type TaeTimelineTrack } from './animation-playback.js';
export declare const ACTION_EDITOR_FRAME_RATE = 30;
export type ActionEditorSelection = {
    kind: 'animation';
    animationId: number;
    taeEntryIndex?: number | undefined;
    taeEntryId?: number | undefined;
    taeEntryName?: string | undefined;
    taeGroup?: string | undefined;
} | {
    kind: 'event';
    animationId: number;
    eventIndex: number;
    taeEntryIndex?: number | undefined;
    taeEntryId?: number | undefined;
    taeEntryName?: string | undefined;
    taeGroup?: string | undefined;
};
export interface ActionAnimationGroup {
    /** Stable UI key. It is deliberately separate from the native animation identity. */
    key: string;
    /** Normalized family label such as a00, a50, or a200. */
    label: string;
    animations: TaeAnimationWire[];
}
export interface ActionAnimationCatalog {
    animations: TaeAnimationWire[];
    groups: ActionAnimationGroup[];
    animationCount: number;
}
export interface ActionAnimationFilter {
    bankKey?: string | undefined;
    query?: string | undefined;
}
export interface ActionAnimationView {
    animations: TaeAnimationWire[];
    groups: ActionAnimationGroup[];
    selectedGroup: ActionAnimationGroup | null;
}
export declare function normalizeActionGroupLabel(value: string): string | null;
/**
 * UI family grouping follows the visible aXXX prefix, while native selection
 * continues to use taeAnimationIdentityKey. This lets a00/a50/a200 collapse
 * together without merging two animations during read/write operations.
 */
export declare function actionAnimationGroupLabel(animation: TaeAnimationWire): string;
export declare function actionAnimationGroupKey(animation: TaeAnimationWire): string;
export declare function groupActionAnimations(animations: readonly TaeAnimationWire[]): ActionAnimationGroup[];
export declare function buildActionAnimationCatalog(document: TaeDocument | null | undefined): ActionAnimationCatalog;
export declare function filterActionAnimations(animations: readonly TaeAnimationWire[], filter?: ActionAnimationFilter): ActionAnimationView;
export declare function findActionAnimation(animations: readonly TaeAnimationWire[], selection: ActionEditorSelection | null | undefined): TaeAnimationWire | undefined;
export declare function actionTimelineRows(animation: TaeAnimationWire): TaeTimelineEventRow[];
export declare function buildActionTimeline(animation: TaeAnimationWire | null | undefined, diagnostics?: readonly TaeDiagnostic[] | undefined, fps?: number): TaeTimelineTrack[];
export declare function actionDurationSeconds(animation: TaeAnimationWire | null | undefined, clipDuration?: number | undefined): number;
export declare function actionAnimationIdentity(animation: TaeAnimationWire): string;
