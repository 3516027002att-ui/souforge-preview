/**
 * Sekiro TAE（.tae，Time Act Editor）文档 wire 类型与三页投影。
 *
 * 与 Bridge 的 read-tae-document 一一对应（ANIMATION-56A）。
 * 布局权威在 C# 侧 TaeNativeDocument.cs；这里的类型只描述 wire 形状，
 * 不维护第二套 native parser。
 *
 * 语义：
 *  - 事件参数体由 Bridge 按 first-party schema 解码；schema 覆盖到的字段可通过
 *    typed mutation 写回，超出 schema 的原始尾部仍随文档保留。
 *  - authority 只在全部事件时间范围合法时为 candidate；存在 startTime > endTime
 *    或非有限时间时降为 partial，并在 diagnostics 里给 TAE_INVALID_TIME_RANGE。
 *  - animations 行只采样前 sampleLimit 条（envelope 内嵌 animationsTruncated），
 *    每行的 events 又是按动画 bounded 的事件时间表（eventsTruncated）。消费方要
 *    全量走后续分页 channel，不要把 envelope 当全量。
 *  - eventTypes 是去重后的 distinct 列表（C# 侧 SortedSet 排序）。
 *
 * `projectTaeDocumentPages` 是纯函数，消费方用它把单个 envelope 投影成
 * animations / timeline / events 三页，不做任何 I/O。
 */
/** TAE envelope 级诊断码。当前只可能来自事件时间范围非法。 */
export const TAE_INVALID_TIME_RANGE = 'TAE_INVALID_TIME_RANGE';
/**
 * 动画的稳定 UI/运行时身份。entryIndex 只在当前 BND4 source 内解释，
 * 与 sourceHash/sourceUri 组合后可作为完整外部身份；animId 不能单独使用。
 */
export function taeAnimationIdentityKey(animation) {
    const entry = Number.isSafeInteger(animation.taeEntryIndex)
        ? `index:${animation.taeEntryIndex}`
        : Number.isSafeInteger(animation.taeEntryId)
            ? `id:${animation.taeEntryId}`
            : `name:${animation.taeEntryName ?? animation.taeGroup ?? 'tae'}`;
    return `${entry}|anim:${animation.animId}`;
}
/** 分组键使用原生 entry 身份，不从 hkxName 或 animId 猜分区。 */
export function taeAnimationGroupKey(animation) {
    if (Number.isSafeInteger(animation.taeEntryIndex))
        return `index:${animation.taeEntryIndex}`;
    if (Number.isSafeInteger(animation.taeEntryId))
        return `id:${animation.taeEntryId}`;
    return `name:${animation.taeEntryName ?? animation.taeGroup ?? 'tae'}`;
}
/** UI 分组标题；a150 等不存在的子项不会被本地补造。 */
export function taeAnimationGroupLabel(animation) {
    const label = animation.taeGroup
        ?? animation.taeEntryName?.replace(/\.tae$/i, '')
        ?? 'TAE';
    return label || 'TAE';
}
/** 运行时 wire 守卫：motionAnimId 缺失/空值表示未解析，不得猜测为 animId。 */
export function isSafeMotionAnimId(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
/** Bounded animation page shared by Desktop and Agent native reads. */
export const TAE_ANIMATION_PAGE_SIZE = 64;
/** 把 read-tae-document envelope 投影成三页。纯函数，不吞异常、不做 I/O。 */
export function projectTaeDocumentPages(doc) {
    const timelineEvents = [];
    let truncatedAnimationCount = 0;
    for (const animation of doc.animations) {
        for (const event of animation.events) {
            timelineEvents.push({
                animId: animation.animId,
                ...event,
                ...(animation.taeEntryIndex === undefined ? {} : { taeEntryIndex: animation.taeEntryIndex }),
                ...(animation.taeEntryId === undefined ? {} : { taeEntryId: animation.taeEntryId }),
                ...(animation.taeEntryName === undefined ? {} : { taeEntryName: animation.taeEntryName }),
                ...(animation.taeGroup === undefined ? {} : { taeGroup: animation.taeGroup })
            });
        }
        if (animation.eventsTruncated)
            truncatedAnimationCount++;
    }
    return {
        animations: {
            animationCount: doc.animationCount,
            animations: doc.animations,
            animationsTruncated: doc.animationsTruncated,
        },
        timeline: {
            events: timelineEvents,
            animationCount: doc.animations.length,
            truncatedAnimationCount,
        },
        events: {
            totalEventCount: doc.totalEventCount,
            totalGroupCount: doc.totalGroupCount,
            eventTypes: doc.eventTypes,
            eventTypeCount: doc.eventTypes.length,
        },
    };
}
/** 窄守卫：判读一个 read-tae-document 响应是不是 TaeDocument。 */
export function isTaeDocument(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.format === 'TAE' && typeof v.sourceHash === 'string' && typeof v.authority === 'string';
}
//# sourceMappingURL=animation-editor.js.map