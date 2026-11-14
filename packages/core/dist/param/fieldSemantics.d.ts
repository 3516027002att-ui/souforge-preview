/**
 * 命中通道：字段 id、native 名、只有经过 CJK 折叠/中文标签才相等，或**只有说明文本里提到**。
 *
 * `description` 是第 60 轮补的：NpcParam 的 `npcType` 名字是 `NPCタイプ`、id 里也没有 boss，
 * 只有说明写「NPCの種類.ザコ敵/ボス敵が区別されていればOK」。说明命中是弱证据——同一个词
 * 在散文里出现不等于这个字段就是用户问的那个——所以它单独成一档，排序永远低于 name。
 */
export type FieldMatchChannel = 'fieldId' | 'name' | 'description' | 'cjk-variant' | 'alias';
/** 命中的具体来源列，比 channel 更细：channel 只有四档，来源有五列。 */
export type FieldMatchSource = 'fieldId' | 'name' | 'description' | 'cjk-label' | 'alias';
export interface FieldConcept {
    /** 稳定概念 id，用于回显与测试。 */
    id: string;
    /** 触发词（中/日/英）：查询规范化后包含任一触发词即展开。 */
    triggers: readonly string[];
    /** 展开出的原生词元：用于匹配 field id / name。 */
    tokens: readonly string[];
    /** 给用户看的中文概念名。 */
    zh: string;
}
/**
 * 概念词表。`health`/`boss`/`attack`/`effect`/`drop` 五条沿用
 * `expandParamFieldQuery` 原有的词元，保持既有排序与召回不变（r50 的 A/B 对照依赖它）；
 * `distance` 与 `range-limit` 是本次新增，用来覆盖「判定距离」这类距离/范围问题。
 */
export declare const FIELD_CONCEPTS: readonly FieldConcept[];
export declare function hasCjk(value: string): boolean;
/** 匹配专用规范形：NFKC → 繁→简 → 小写。只用于比较，返回值仍是数据原文。 */
export declare function foldFieldText(value: string): string;
export interface ExpandedFieldQuery {
    /** 规范化后的整句，原样回显给调用方。 */
    normalizedQuery: string;
    /** 用户自己写下的词元（规范化、已折叠）。 */
    userTerms: string[];
    /** 概念展开出的原生词元。 */
    conceptTokens: string[];
    /** 命中的概念 id，按词表顺序。 */
    conceptIds: string[];
    /** 命中的概念（id + 中文概念名），用于把「血条数 = 必要忍杀次数」这类等同关系回显给调用方。 */
    concepts: Array<{
        id: string;
        zh: string;
    }>;
    /** 覆盖度计算用：用户词元 + 概念词元。 */
    coverageTerms: string[];
    /**
     * 评分/匹配用：整句（多词时）+ coverageTerms。
     * 整句单列是因为英文名 `Reference Distance` 只有整句才能精确命中。
     */
    matchTerms: string[];
    /** 用户实际写下的词数，覆盖度阈值按它算。 */
    userTermCount: number;
    /** 查询里是否含 CJK。 */
    hasCjk: boolean;
}
/**
 * 展开一条字段查询。
 *
 * 与旧 `expandParamFieldQuery` 的兼容点：词元仍然按空白/逗号/顿号/斜杠切分，
 * 五个旧概念的词元一字不改，所以 'health'、'boss'、'禁' 等既有查询的召回与排序不变。
 */
export declare function expandFieldQuery(query: string): ExpandedFieldQuery;
/** 旧接口：只返回词元数组。保持既有调用方与测试不变。 */
export declare function expandFieldQueryTerms(query: string): string[];
/**
 * 分类一次命中：返回该字段最强的命中通道。
 *
 * `cjk-variant` 的判定标准是「字面不相等，只有折叠/翻译后才相等」：
 * 查询「距离」命中 native 名「…判定距離」时字面不等（離≠离），所以是 cjk-variant；
 * 查询「判定」命中同一个名字时字面相等，所以是 name。调用方据此判断能否把结果
 * 当成「用户说的就是这个名字」。
 *
 * `description` 与它们并列但不是同一件事：命中的是**说明文本**，不是名字本身。
 * 它的档位最低且不吃 CJK 加权（`fromCjkTerm` 的 +10 只给 id/name/label），
 * 这样「说明里提过一次」永远不会盖过「名字就是这个词」。
 *
 * `alias` 是收录的别名（旧工具名、英文注解、常见中文叫法）命中，不是 native 名：
 * `ninsatuNum` 的 native 名是「必要忍殺回数」，而 `HealthbarNum` / `Amount of healthbars`
 * / 「血条数」只是收录表里的叫法。它排在 fieldId 之下、name 之上——别名是人工钉在
 * schema 上的（测试校验），比「名字里恰好含这个词」更能解释「他说的就是这个字段」。
 *
 * `preferCjkTerms` 决定「中文词元命中算不算最贴切」：用户自己写中文时算（默认），
 * 用户写拉丁英文名时不算——否则查询 `isSoulGetByBoss` 会经概念展开带出 `ボス`，
 * 让 names 里的 ボス 抢走「这个 id 就是你要的那个字段」的解释权。
 */
export declare function classifyFieldMatch(input: {
    fieldId?: string;
    name?: string;
    description?: string;
    cjkLabels?: readonly string[];
    aliases?: readonly string[];
}, terms: readonly string[], options?: {
    preferCjkTerms?: boolean;
    wholeQuery?: string;
}): {
    matchedBy: FieldMatchChannel;
    matchedField: FieldMatchSource;
    matchedTerms: string[];
} | undefined;
/**
 * 说明命中的回显片段：命中词前后各留 `radius` 个字符，让人能自己判断相关不相关。
 *
 * 折叠会换字形（NFKC、繁→简），所以逐字符折叠一遍并记下「折叠后下标 → 原文下标」，
 * 用这份映射把命中位置还原到**数据原文**上——回显的永远是原文，不是折叠形。
 * 逐字符折叠与整串折叠在极少数字形组合下会不等，此时按逐字符那份定位即可：
 * 匹配判定仍在整串折叠上做，片段只影响回显位置。
 */
export declare function fieldDescriptionSnippet(description: string | undefined, terms: readonly string[], radius?: number): string | undefined;
export interface TaeFieldLabel {
    eventTypeId: number;
    fieldName: string;
    /** 中文写法（含常见省略），必须能匹配用户原话。 */
    zh: readonly string[];
    /** 只写 schema/仓库校验能支撑的语义。 */
    semantics: string;
}
export declare const TAE_FIELD_LABELS: readonly TaeFieldLabel[];
/**
 * PARAM 字段的人工收录。这里只放「paramdef 原文无法机械推出的说法」：
 *
 *   · `aliases`：同一字段在旧工具、英文注解或用户口语里的名字。命中的是别名，
 *     不是 native 名，所以 classifyFieldMatch 会报 `matchedBy=alias`，
 *     `matchKind=curated-label`；
 *   · `concepts`：指向 {@link FIELD_CONCEPTS} 的概念 id。查询命中该概念时，
 *     这个字段在目录里直接置顶——「血条数 = 必要忍杀次数」就是这条链路；
 *   · `semantics`：只写 schema 与工作区数据能支撑的语义，不编造。
 *
 * 每条都按 (paramType, fieldId) 钉在 first-party schema 上，`fieldSemantics.test.ts`
 * 断言它真实存在：schema 升级把字段改名/删掉时测试失败，而不是继续给出查不到的答案。
 */
export interface ParamFieldLabel {
    /** native 类型名（PARAM 表名），必须与 schema 的 typeName 完全一致。 */
    paramType: string;
    fieldId: string;
    /** 可检索的别名：旧工具名、paramdef 英文注解、用户口语名。 */
    aliases: readonly string[];
    /** 概念 id：查询命中这些概念时该字段置顶。 */
    concepts: readonly string[];
    /** 自解释的语义说明，回显在候选的 `semantics`。 */
    semantics: string;
}
export declare const PARAM_FIELD_LABELS: readonly ParamFieldLabel[];
/** 命中性质：调用方据此判断这条候选是「用户说的就是它」还是「只是词汇相关」。 */
export type FieldMatchKind = 'curated-label' | 'exact-name' | 'field-id' | 'field-name' | 'description';
export interface FieldCandidate {
    domain: 'param' | 'tae';
    /** 最强命中通道。 */
    matchedBy: FieldMatchChannel;
    /** 命中的具体列：fieldId / name / description / cjk-label。 */
    matchedField: FieldMatchSource;
    /** 命中的性质，比 matchedBy 更适合决定「能不能直接当答案」。 */
    matchKind: FieldMatchKind;
    matchedTerms: string[];
    score: number;
    name: string;
    type?: string;
    description?: string;
    /** `matchedBy === 'description'` 时给出原文片段，让调用方自己判断相关不相关。 */
    descriptionSnippet?: string;
    /** PARAM：字段属于哪张表（native 类型名，可直接当 table 用）。 */
    table?: string;
    paramType?: string;
    fieldId?: string;
    /** TAE：事件类型与所属 bank（同 id 的变体合并）。 */
    eventTypeId?: number;
    eventName?: string;
    banks?: string[];
    /** 收录字段的语义说明；没有收录就没有这个键，不编造。 */
    semantics?: string;
    /** PARAM 收录别名（旧工具名/英文注解/用户口语）；`matchedBy=alias` 时说明命中的是哪几列。 */
    aliases?: string[];
}
/**
 * 在 PARAM 定义目录里找字段（不需要工作区、不需要先定位行）。
 *
 * `table` 是**过滤**而不是排序提示：只返回该表的字段。`table` 可以写 native 类型名
 * （`SP_EFFECT_PARAM_ST`）或容器里的物理子文件名（`SpEffectParam`、`ThrowParam`），
 * 折叠规则见 `resolveGameParamTable`。解析不出来就返回空数组——调用方必须先问
 * {@link resolveGameParamTable} 拿到确定答案，再决定是报错还是说「没有字段匹配」，
 * 否则「表不存在」和「表存在但没这个字段」会被混成同一句空结果。
 */
export declare function searchParamFieldCatalog(query: string, options?: {
    table?: string;
    limit?: number;
}): FieldCandidate[];
/**
 * paramdef 语料里有、但本作 gameparam 里没有对应表的字段。
 *
 * 这不是「候选」：调用方不能用它去读/写字段。它只解释一件事——「AI_ATTACK_PARAM_ST
 * 有 successDistance」这种说法来自 paramdef 类型字典，游戏容器里没有这张表，所以
 * 顺着它找「追斩距离」是死路。返回结构与 {@link searchParamFieldCatalog} 一致，
 * 让调用方可以原样回显 table/fieldId。
 */
export declare function searchParamFieldCatalogNotInGame(query: string, options?: {
    table?: string;
    limit?: number;
}): FieldCandidate[];
/** 本作 gameparam 实际存在的 PARAM 表数量（不是 paramdef 类型数）。 */
export declare function gameParamTableCount(): number;
/**
 * 把一个 `table` 拼写解析成「是不是本作的表」的确定答案。
 *
 * 三种结果必须能分开，否则工具只能把两种失败混成同一句空结果：
 *   · `inGame`：本作 gameparam 里有这张表（`paramType` 是它的 native 类型名）；
 *   · `inParamdef: true` 但 `inGame: false`：只在随包 paramdef 里定义，本作没有子文件；
 *   · 两个都 false：连 paramdef 都没这个类型（拼错或根本不是 PARAM 表）。
 */
export declare function describeTableSpelling(spelling: string): {
    requested: string;
    paramType?: string;
    inGame: boolean;
    inParamdef: boolean;
};
/** 在 TAE 事件字段目录里找字段。收录字段的中文标签优先级最高。 */
export declare function searchTaeFieldCatalog(query: string, options?: {
    limit?: number;
}): FieldCandidate[];
/** 跨域一次查：TAE 在前（动作层问句更常见），PARAM 在后。 */
export declare function searchFieldVocabulary(query: string, options?: {
    domain?: 'param' | 'tae' | 'all';
    table?: string;
    limit?: number;
}): FieldCandidate[];
/** 目录规模，供工具的 provenance 回显；数字来自随包 schema，不手写常量。 */
export declare function fieldCatalogStats(): {
    paramDefinitions: number;
    paramGameTables: number;
    paramDefinitionsNotInGame: number;
    paramFields: number;
    taeEventTypes: number;
    taeFields: number;
    curatedLabels: number;
    curatedParamFields: number;
};
/**
 * 两个目录里出现过的字段名（去重，保留第一个所属表/事件）。
 * 只给零命中时的「最接近」用；不是一次完整枚举，调用方不要拿它当字段清单。
 */
export declare function fieldCatalogNames(limit?: number): Array<{
    domain: 'param' | 'tae';
    fieldId?: string;
    name: string;
    table?: string;
    paramType?: string;
}>;
/**
 * 零命中时的「最接近」候选：不猜语义，只按用字/拼写接近程度给下一步。
 *
 * CJK 查询用等长单字替换（和 search_text_entries 的 variantHints 同一套），
 * 拉丁查询用「同 token 前缀/包含」近似；两种都只返回数据原文里的字段名。
 */
export declare function nearestFieldCandidates(query: string, candidates: readonly {
    fieldId?: string;
    name: string;
    table?: string;
    paramType?: string;
}[], limit?: number): Array<{
    fieldId?: string;
    name: string;
    table?: string;
    paramType?: string;
    reason: string;
}>;
