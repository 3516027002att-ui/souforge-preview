/**
 * TAE Bridge stage helpers（ANIMATION-56C）— writers only touch staging; callers commit via Patch Engine.
 *
 * 与 esdBridgeCommit / materialBridgeCommit 同一范式：调用方给出 typed event
 * upsert mutation（tae-event-upsert），main 侧经 Patch Engine 的 outer stage 落到
 * 暂存区，由 write-tae-document 重读验证后才进入 Patch。
 *
 * 三条 mutation kind：
 *   · update-event-times —— 字节级外科替换某动画某个事件的 startTime/endTime
 *     float32。动画按 animId 定位（读信封的 stable id），事件按事件表下标
 *     eventIndex 定位。时间槽被兄弟事件共享时 C# 侧 fail-closed（sibling
 *     verify：共享槽改写会非预期地改动兄弟事件）。
 *   · insert-event —— 追加一个新事件到动画事件表末尾。事件参数体按原生
 *     eventTypeId/变体逐字节拷贝自模板
 *     事件（templateEventIndex 定位）；布局不连续时 C# 侧以
 *     TAE_WRITE_BLOCKED_UNKNOWN_STRUCTURE fail-closed，不落盘。
 *   · set-event-field —— 按 first-party schema 的 fieldIndex/fieldName 写入
 *     一个有类型字段，保留事件参数尾部。
 *
 * 注意：TAE 在 Sekiro 中通常位于 anibnd.dcx 容器内子项。本层先把 child
 * 写入 staging，再经 native BND4/DCX writer 重建外层；Patch Engine 仍是
 * 唯一提交 Mod 资源的入口。
 */
/** 一条 TAE 事件 upsert mutation。source 定位用 animId + 事件表下标。 */
export type TaeEventUpsertMutation = {
    mutation: 'update-event-times';
    /** 目标动画 id（读信封 animations[].animId）。 */
    animId: number;
    /** 目标事件在事件表内的下标（读信封 animations[].events[] 的顺序）。 */
    eventIndex: number;
    /** 新起始时间（有限且 ≤ endTime，否则 C# 侧 fail-closed）。 */
    startTime: number;
    /** 新结束时间（有限且 ≥ startTime，否则 C# 侧 fail-closed）。 */
    endTime: number;
    /** ANIBND child selector; omitted for loose .tae. */
    taeEntryIndex?: number;
} | {
    mutation: 'insert-event';
    /** 目标动画 id。 */
    animId: number;
    /** 模板事件下标：新事件的参数体逐字节拷贝自该事件（类型必须一致）。 */
    templateEventIndex: number;
    /** Same-document action or a hash-bound native document supplied by the host. */
    templateAnimId?: number;
    templateDocumentBase64?: string;
    expectedTemplateDocumentHash?: string;
    schemaBankId?: number;
    fieldOverrides?: Array<{
        fieldIndex?: number;
        fieldName?: string;
        value: string | number | boolean;
    }>;
    /** 新事件类型；缺省用模板事件类型。若提供且与模板不一致 → C# 侧 fail-closed。 */
    eventTypeId?: number;
    startTime: number;
    endTime: number;
    /** ANIBND child selector; omitted for loose .tae. */
    taeEntryIndex?: number;
} | {
    mutation: 'set-event-field';
    animId: number;
    eventIndex: number;
    fieldIndex?: number;
    fieldName?: string;
    value: string | number | boolean;
    schemaBankId?: number;
    /** ANIBND child selector; omitted for loose .tae. */
    taeEntryIndex?: number;
};
export interface TaeBridgeCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutations: TaeEventUpsertMutation[];
    timeoutMs?: number;
    oodleRuntimeRoot?: string;
}
export interface TaeBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    outputSize?: number;
    mutationCount?: number;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
        details?: unknown;
    }>;
}
export declare function commitTaeEventViaBridge(request: TaeBridgeCommitRequest): Promise<TaeBridgeCommitResult>;
/**
 * Rebuild one TAE child inside an ANIBND/DCX container without making the
 * container parser a second TAE writer. The child is extracted into the
 * caller-owned staging directory, rewritten by the first-party TAE Bridge,
 * then replaced through the native BND4/DCX writer. No Mod file is touched
 * before the outer Patch Engine commit.
 */
export declare function commitTaeEventContainerViaBridge(request: TaeBridgeCommitRequest & {
    taeEntryIndex?: number;
}): Promise<TaeBridgeCommitResult>;
