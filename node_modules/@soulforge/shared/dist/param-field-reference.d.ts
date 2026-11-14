/**
 * PARAM 字段的跨表引用（Smithbox `Param Meta` 的 `Refs=` 属性）。
 *
 * ── 这层解决什么 ──
 *
 * param 里绝大多数「有意义的整数」其实是另一张表的行 id：`BehaviorParam.refId`
 * 指向 `AtkParam_Npc` 的某一行，`NpcParam.spEffectId` 指向 `SpEffectParam`。
 * 没有这层，用户看到的是一个裸数字，想知道它是什么必须自己记住「哪个字段指向
 * 哪张表」，再手动切表、手动搜 id。
 *
 * ── 语法是实测的，不是照规格猜的 ──
 *
 * 2026-08-10 对 Smithbox SDT 2.2.4 的 160 个 `Param Meta` XML 全量统计：
 *   Refs 属性 450 条，目标 475 个，其中
 *     无条件 `Target`                437
 *     条件   `Target(field=value)`    38
 *   单字段最多 4 个目标；出现其他形态 0 个。
 *
 * 所以只有两种形态，两种都在 {@link parseParamFieldRefs} 里显式处理；解析不出的
 * 目标一律丢弃并计入 `rejected`，不猜第三种语法。
 *
 * ── 条件引用为什么不能忽略 ──
 *
 * 最富的一条真实数据：
 *   `Refs="Bullet(refType=1),AtkParam_Npc(refType=0),AtkParam_Pc(refType=0),SpEffectParam(refType=2)"`
 * 同一个 `refId` 指向哪张表，取决于同行 `refType` 的值。忽略条件就会把 4 个目标
 * 都当成有效，用户点进去 3 个是错的 —— 比不给跳转更糟。条件字段全部是**同表
 * 同行的兄弟字段**（实测 38/38 都能在同一个 Defs 里找到），所以判定只需要当前行
 * 已解码的值，不需要额外读取。
 *
 * ── 目标命名空间（实测，反直觉） ──
 *
 * `Refs` 的目标名**不是** ParamType（`SP_EFFECT_PARAM_ST`），也不是 Defs 文件名
 * （`SpEffect`），而是**容器条目名**（`SpEffectParam`）—— 即 parambnd 里
 * `SpEffectParam.param` 去掉扩展名，也正是左栏列出的名字。实测依据：
 *   · 475 个目标里 138 个在 Defs 文件名与 ParamType 两个命名空间里都找不到，
 *     其中 `SpEffectParam` 一项就出现 118 次；
 *   · 换用 `Param Type Info.json` 的 `Mapping`（138 个键）后，41 个目标里 40 个
 *     命中，且 `Mapping` 的键集与真实 gameparam.parambnd.dcx 的 138 个 param
 *     条目名**完全相等**（双向无差集，已对真实容器验证）；
 *   · `Param Categories/Common.json` 用的也是这一套名字，构成独立第二来源。
 *
 * 结论：跳转目标可以直接和左栏条目名比对，不需要任何类型翻译。
 *
 * ── 大小写 ──
 *
 * Smithbox 自己的数据里有一处拼写不一致：`BehaviorParam_Pc` 与 `BehaviorParam_PC`
 * 并存，而容器里只有后者。138 个条目名在忽略大小写后仍然互不相同（实测无碰撞），
 * 所以这里用大小写不敏感匹配，把那处笔误一并救回，且不会引入歧义。
 */
/** 引用生效的条件：同一行另一个字段必须等于某个值。 */
export interface ParamFieldRefCondition {
    /** 兄弟字段 id（与被引用字段同表同行）。 */
    fieldId: string;
    /** 该字段必须相等的整数值。 */
    value: number;
}
/** 一个引用目标。 */
export interface ParamFieldRefTarget {
    /**
     * 目标 param 的容器条目名（如 `SpEffectParam`），可直接与左栏条目名比对。
     * 保留原始大小写；匹配请用大小写不敏感比较（见本文件头部说明）。
     */
    param: string;
    /** 有值表示这是条件引用，仅当条件成立时该目标才有效。 */
    condition?: ParamFieldRefCondition;
}
export interface ParamFieldRefParseResult {
    targets: ParamFieldRefTarget[];
    /** 语法不认识而被丢弃的原始片段。非空即说明遇到了未知形态。 */
    rejected: string[];
}
/**
 * 单个字段最多允许的引用目标数。
 *
 * 实测真实数据最多 4 个；给到 16 是留余量，同时防住畸形输入把 UI 撑爆。
 */
export declare const PARAM_FIELD_REF_MAX_TARGETS = 16;
/**
 * 解析一条 `Refs=` 属性值。
 *
 * 不抛异常：元数据是外部数据，一个畸形片段不该让整个字段栏打不开。无法识别的
 * 片段进 `rejected`，调用方可据此给出诊断，而不是静默当成「没有引用」。
 */
export declare function parseParamFieldRefs(input: unknown): ParamFieldRefParseResult;
/**
 * 在给定的行字段值下，挑出真正生效的目标。
 *
 * `fieldValues` 是当前行已解码的值（fieldId → 数值）。语义：
 *   · 无条件目标恒生效；
 *   · 条件目标只在该兄弟字段**已解码且相等**时生效 —— 解不出来时按不生效处理，
 *     因为「不知道 refType 是几」不能推出「这个目标是对的」。
 */
export declare function selectActiveParamFieldRefs(targets: readonly ParamFieldRefTarget[], fieldValues: ReadonlyMap<string, number>): ParamFieldRefTarget[];
