/**
 * 字段名的语义层：把「用户怎么称呼一个字段」变成可机械执行的匹配。
 *
 * ── 这层解决什么 ──
 *
 * 第 43 轮盲测：用户说「判定距离」，工具答不出对应哪个字段，agent 只能同时写
 * `Reference Distance` 与 `Enable Range Maximum` 两个字段兜底。原因是三层都缺：
 *
 *   1. `search_param_fields` 只做纯字符串包含：查询「距离」匹配不到 native 名
 *      `ネットワーク移動判定距離`（数据写日文繁体 距離，查询写简体 距离），返回 0 条；
 *   2. PARAM 字段名根本没有中文说明，查询「判定距离」只能靠用户猜英文名；
 *   3. `判定距离` 其实是 TAE 事件字段（`Set Root Motion Multiplier` 的
 *      `Reference Distance` / `Enable Range Maximum`），而字段搜索只覆盖 PARAM，
 *      跨域没有入口。
 *
 * 所以这里做三件只影响「匹配」、不改写任何数据原文的事：
 *
 *   · 折叠：查询与字段名都走 {@link normalizeCjkMatchForm}（NFKC → 繁→简），
 *     于是「距离」能匹配「距離」。命中的是折叠形时必须标 `cjk-variant`，
 *     调用方才知道这不是字面命中。
 *   · 概念展开：中文概念 → 原生英文词元（距离 → distance/dist/range…）。
 *     词表是**概念**而不是「答案」：`distance` 概念不会直接指向某个字段，
 *     只把 query 扩成词元，再由字段名自己决定命中哪些。答错的代价因此是「多召回」，
 *     不是「认错字段」。
 *   · PARAM 收录别名：少数字段的常用叫法与 paramdef 原文完全无关（`ninsatuNum` 的
 *     日文名是「必要忍殺回数」、英文注解是 `Amount of healthbars`、旧工具名是
 *     `HealthbarNum`，而用户说「血条数」「忍杀次数」）。{@link PARAM_FIELD_LABELS}
 *     把这些叫法钉到 (paramType, fieldId) 上，并声明它属于哪个概念；查询命中该概念时
 *     该字段直接置顶。别名/概念都是**收录**，测试断言它们指向的字段真实存在于
 *     first-party schema，schema 升级改名会让测试失败，而不是悄悄给出查不到的答案。
 *   · 跨域索引：PARAM 的 160 条 paramdef 定义与 TAE 的 500 个事件类型/3459 个字段都来自
 *     随包发布的 first-party schema，不读游戏文件、不联网。查询一次可以同时回答
 *     「这是 PARAM 哪张表的哪个字段」和「这是 TAE 哪个事件字段」。
 *   · 但 PARAM 侧只收**本作 gameparam 里真实存在的表**：paramdef 是类型字典（160 个类型），
 *     容器只有 122 个 native 类型（`schema/sekiro/gameParamTables.ts`）。不存在的 38 个类型
 *     （AI_ATTACK_PARAM_ST / MISSILE_PARAM_ST / YEBIS_BANK / FOG_BANK / CS_*_QUALITY_DETAIL …）
 *     不会成为候选：它们在游戏里没有子文件，把它们的字段名当答案是「照着不存在的表去改数据」。
 *     这类命中单独走 {@link searchParamFieldCatalogNotInGame}，只用于解释「这个名字为什么查不到表」。
 *
 * ── 为什么 TAE 侧要带一张收录表 ──
 *
 * TAE schema 只有英文名字段，没有任何中文说明。要让「判定距离」这个名字被机械查到，
 * 必须有中文标签。{@link TAE_FIELD_LABELS} 是唯一的人工知识，所以它被限制成
 * 「字段 → 中文别名 + 语义说明」，并且：
 *
 *   · 每条都按 (eventTypeId, fieldName) 钉在 first-party TAE schema 上；
 *   · `fieldSemantics.test.ts` 断言每一条都真实存在于 schema 里——schema 升级把字段
 *     改名后，测试会失败，而不是悄悄给出一个查不到的答案；
 *   · 语义说明只写 schema 与仓库既有校验能支撑的部分（例如
 *     `Enable Range Maximum < Reference Distance` 会让 760 事件永不启用，
 *     这条来自 taeEdit.ts 的 TAE_EVENT_UNREACHABLE）。
 *
 * 没有收录的中文字段不会被编造：它们仍然只能通过英文名或概念词元命中。
 */
import { normalizeCjkMatchForm } from '../indexing/cjkVariants.js';
import { FIRST_PARTY_PARAM_METADATA_PACKAGE } from '../schema/sekiro/firstPartySchemaData.js';
import { FIRST_PARTY_TAE_SCHEMA } from '../schema/sekiro/firstPartyTaeSchemaData.js';
import { isGameParamTable, resolveGameParamTable, SEKIRO_GAME_PARAM_TABLES, tableKey } from '../schema/sekiro/gameParamTables.js';
/**
 * 概念词表。`health`/`boss`/`attack`/`effect`/`drop` 五条沿用
 * `expandParamFieldQuery` 原有的词元，保持既有排序与召回不变（r50 的 A/B 对照依赖它）；
 * `distance` 与 `range-limit` 是本次新增，用来覆盖「判定距离」这类距离/范围问题。
 */
export const FIELD_CONCEPTS = [
    {
        id: 'health',
        triggers: ['血条', '生命', '生命值', '生命槽', '忍杀', '忍殺', '血量', '红点', 'ninsatu', 'ninsatsu', 'hp', 'health', 'vitality', 'hitpoint', 'life'],
        tokens: ['hp', 'health', 'vitality', 'hitpoint', 'ninsatu', 'ninsatsu', '忍殺', '忍杀', 'maxhp'],
        zh: '生命/血条'
    },
    {
        // 「血条数」不是「血量」：它是这个 NPC 要忍杀几次才死（必要忍殺回数 = 血条条数）。
        // 字段 id 叫 ninsatuNum，日文名全是汉字、英文注解只写 Amount of healthbars，
        // 所以用户说的「血条数」「忍杀次数」「healthbar」「deathblow」此前只能靠 ninsatu
        // 词元在 id 上碰运气命中，排在 hp 之后。这里把说法收成一个概念，再由
        // PARAM_FIELD_LABELS.concepts 把它钉到 NpcParam.ninsatuNum；概念触发词本身
        // 进入该字段的收录别名表，所以召回落在「用户说的就是这个字段」这一档上。
        id: 'healthbar-count',
        triggers: ['血条', '血条数', '血條', '血條數', '忍杀', '忍殺', '忍杀次数', '忍殺次數', '忍殺回数', '忍杀回数', 'healthbar', 'health bar', 'deathblow', 'death blow', 'healthbarnum'],
        // 概念本身不贡献字段名词元：它靠 PARAM_FIELD_LABELS.concepts 直接指向字段
        // （收录别名 = 声明的别名 + 这些触发词）。这样「血条」不会因为一个 id 词元
        // 被误报成 matchedBy=fieldId。
        tokens: [],
        zh: '血条数（= 必要忍杀次数 / Amount of healthbars）'
    },
    {
        id: 'boss',
        triggers: ['精英', '首领', '头目', 'boss', 'elite', 'miniboss'],
        // 「ボス」是数据原文里的写法：NpcParam.npcType 的说明只有日文「ザコ敵/ボス敵」，
        // 不带这个原生词元时英文 boss / 中文 精英 都搜不到那个字段。
        tokens: ['elite', 'boss', 'miniboss', 'difficulty', 'rank', 'ボス'],
        zh: '精英/boss'
    },
    {
        id: 'hostility',
        triggers: ['攻击', '敌对', '阵营', '队伍', '目标', 'attack', 'hostile', 'team', 'target', 'faction'],
        tokens: ['attack', 'hostile', 'team', 'target', 'faction', 'teamtype', '所属', '敵対'],
        zh: '敌对/阵营'
    },
    {
        id: 'effect',
        triggers: ['落雷', '雷', '特效', '效果', 'lightning', 'effect', 'sfx', 'spawn'],
        tokens: ['lightning', 'effect', 'sfx', 'spawn', '特効'],
        zh: '特效/落雷'
    },
    {
        id: 'drop',
        triggers: ['掉落', '奖励', '抽选', '抽選', '物品', '道具', '铃铛', 'drop', 'reward', 'item', 'lot', 'goods', 'loot'],
        tokens: ['drop', 'reward', 'item', 'lot', 'goods', 'itemlot', '抽選', '抽选', '報酬'],
        zh: '掉落/奖励'
    },
    {
        id: 'distance',
        triggers: ['判定距离', '判定距離', '距离', '距離', '范围', '範圍', '射程', '间隔', '間隔', 'dist', 'distance', 'range', 'radius'],
        // 只放长度 ≥ 4 的拉丁词元，避免 'max'/'min' 这类短词把整张表刷出来。
        tokens: ['distance', 'dist', 'range', 'radius', 'length', 'span'],
        zh: '距离/范围'
    },
    {
        id: 'range-limit',
        triggers: ['启用范围', '上限', '下限', '最大值', '最小值', 'maximum', 'minimum'],
        tokens: ['maximum', 'minimum'],
        zh: '范围上下限'
    },
    {
        // 「毒」在 PARAM 里几乎不写成汉字：SpEffectParam 的 id 是 `poizonAttackPower`（paramdef
        // 原文就是 poizon，不是笔误的容错）、名字是 `Aux Inflict +: Poison`。不做这层展开时，
        // 中文「毒」只能命中别处写「毒耐性」的 CJK 名字，于是 `{query:"毒", table:"SpEffectParam"}`
        // 会得出「这张表没有毒字段」——实际上它有 5 个。词元只放数据原文里出现过的两种拼写。
        id: 'poison',
        triggers: ['毒', '中毒', '毒耐性', '毒攻', 'poison', 'poizon'],
        tokens: ['poison', 'poizon'],
        zh: '毒/中毒/毒耐性'
    }
];
/** 判定一个词元是否属于「CJK 侧」：中文/日文/韩文。 */
const CJK_TEXT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u;
const QUERY_SEPARATORS = /[\s,，、/]+/u;
/**
 * 英文虚词：不作为独立检索词元。它们既不是字段名，也不该靠子串把整页刷成假命中。
 * 注意这只影响**分词后的词元**；带空格的整句仍然参与匹配（短语别名/英文全名）。
 */
const ENGLISH_STOPWORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
export function hasCjk(value) {
    return CJK_TEXT.test(value);
}
/** 匹配专用规范形：NFKC → 繁→简 → 小写。只用于比较，返回值仍是数据原文。 */
export function foldFieldText(value) {
    return normalizeCjkMatchForm(value).toLocaleLowerCase('en-US');
}
/**
 * 展开一条字段查询。
 *
 * 与旧 `expandParamFieldQuery` 的兼容点：词元仍然按空白/逗号/顿号/斜杠切分，
 * 五个旧概念的词元一字不改，所以 'health'、'boss'、'禁' 等既有查询的召回与排序不变。
 */
export function expandFieldQuery(query) {
    const normalizedQuery = foldFieldText(query.trim());
    // 用户词元保留原写法（只小写）：分类时要区分「用户写的 距離 与数据的 距離 字面相等」
    // 和「用户写的 距离 只有折叠后才等于数据的 距離」。匹配时再各自折叠。
    const seenUserTerms = new Set();
    const userTerms = [];
    for (const part of query.trim().toLocaleLowerCase('en-US').split(QUERY_SEPARATORS)) {
        if (!part)
            continue;
        const key = foldFieldText(part);
        // 英文虚词不是字段名的一部分，却是子串命中的放大器：查询
        // `Amount of healthbars`（ninsatuNum 的 paramdef 注解）里的 `of` 会命中
        // `Falloff Start` 这类 TAE 字段名，8 条弱 TAE 命中把真正的收录 PARAM 字段
        // 挤出窗口。整句仍然保留在 matchTerms 里（带空格的查询），所以短语别名不受影响。
        if (ENGLISH_STOPWORDS.has(key))
            continue;
        if (seenUserTerms.has(key))
            continue;
        seenUserTerms.add(key);
        userTerms.push(part);
    }
    const conceptTokens = [];
    const conceptIds = [];
    const concepts = [];
    for (const concept of FIELD_CONCEPTS) {
        if (!concept.triggers.some((trigger) => normalizedQuery.includes(foldFieldText(trigger))))
            continue;
        conceptIds.push(concept.id);
        concepts.push({ id: concept.id, zh: concept.zh });
        for (const token of concept.tokens) {
            const folded = foldFieldText(token);
            if (!conceptTokens.includes(folded))
                conceptTokens.push(folded);
        }
    }
    const coverageTerms = [...new Set([...userTerms, ...conceptTokens])];
    const matchTerms = normalizedQuery.includes(' ')
        ? [...new Set([normalizedQuery, ...coverageTerms])]
        : coverageTerms;
    return {
        normalizedQuery,
        userTerms,
        conceptTokens,
        conceptIds,
        concepts,
        coverageTerms,
        matchTerms,
        userTermCount: Math.max(1, userTerms.length),
        hasCjk: hasCjk(query)
    };
}
/** 旧接口：只返回词元数组。保持既有调用方与测试不变。 */
export function expandFieldQueryTerms(query) {
    return expandFieldQuery(query).matchTerms;
}
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
export function classifyFieldMatch(input, terms, options = {}) {
    if (terms.length === 0)
        return undefined;
    const preferCjkTerms = options.preferCjkTerms ?? true;
    const rawId = input.fieldId?.toLocaleLowerCase('en-US') ?? '';
    const rawName = input.name?.toLocaleLowerCase('en-US') ?? '';
    const foldedId = input.fieldId === undefined ? '' : foldFieldText(input.fieldId);
    const foldedName = input.name === undefined ? '' : foldFieldText(input.name);
    const foldedDescription = input.description === undefined ? '' : foldFieldText(input.description);
    const foldedLabels = (input.cjkLabels ?? []).map(foldFieldText);
    const foldedAliases = (input.aliases ?? []).map(foldFieldText);
    const rank = { 'fieldId': 6, 'alias': 5, 'name': 4, 'cjk-variant': 2, 'description': 1 };
    let best;
    let bestRank = -1;
    const matchedTerms = new Set();
    const consider = (channel, source, fromCjkTerm) => {
        // 用户用中文问时，中文侧的命中才是「他说的那个名字」；拉丁词元在 id 上的偶然包含
        // （判定距离 → networkWarpDist 里的 dist）不该抢走 matchedBy 的解释权。
        // 说明文本命中一律不加权：散文里出现同一个词不是命名证据。
        const score = rank[channel] + (preferCjkTerms && fromCjkTerm && channel !== 'description' ? 10 : 0);
        if (score <= bestRank)
            return;
        bestRank = score;
        best = { matchedBy: channel, matchedField: source };
    };
    for (const term of terms) {
        const rawTerm = term.toLocaleLowerCase('en-US');
        const foldedTerm = foldFieldText(term);
        if (foldedTerm.length === 0)
            continue;
        const fromCjkTerm = hasCjk(term);
        if (foldedId.length > 0 && foldedId.includes(foldedTerm)) {
            matchedTerms.add(term);
            consider(rawId.includes(rawTerm) ? 'fieldId' : 'cjk-variant', 'fieldId', fromCjkTerm);
        }
        if (foldedName.length > 0 && foldedName.includes(foldedTerm)) {
            matchedTerms.add(term);
            consider(rawName.includes(rawTerm) ? 'name' : 'cjk-variant', 'name', fromCjkTerm);
        }
        if (foldedAliases.some((alias) => alias.includes(foldedTerm))) {
            matchedTerms.add(term);
            consider('alias', 'alias', fromCjkTerm);
        }
        if (foldedLabels.some((label) => label.includes(foldedTerm))) {
            matchedTerms.add(term);
            consider('cjk-variant', 'cjk-label', fromCjkTerm);
        }
        if (foldedDescription.length > 0 && foldedDescription.includes(foldedTerm)) {
            matchedTerms.add(term);
            consider('description', 'description', fromCjkTerm);
        }
    }
    if (best === undefined)
        return undefined;
    // 整句就是收录别名时，别名是最贴切的解释：概念展开出的 ninsatu 词元可能在 fieldId 里
    // 偶然命中，但用户打的不是那个 id（HealthbarNum 的 id 其实是 ninsatuNum）。
    // 只有整句相等才覆盖，避免把「ninsatuNum」这类真正的 id 查询降级成别名。
    const wholeQuery = options.wholeQuery === undefined ? undefined : foldFieldText(options.wholeQuery);
    if (wholeQuery !== undefined && foldedAliases.some((alias) => alias.length > 0 && alias === wholeQuery)) {
        return { matchedBy: 'alias', matchedField: 'alias', matchedTerms: [...matchedTerms] };
    }
    return { ...best, matchedTerms: [...matchedTerms] };
}
/**
 * 说明命中的回显片段：命中词前后各留 `radius` 个字符，让人能自己判断相关不相关。
 *
 * 折叠会换字形（NFKC、繁→简），所以逐字符折叠一遍并记下「折叠后下标 → 原文下标」，
 * 用这份映射把命中位置还原到**数据原文**上——回显的永远是原文，不是折叠形。
 * 逐字符折叠与整串折叠在极少数字形组合下会不等，此时按逐字符那份定位即可：
 * 匹配判定仍在整串折叠上做，片段只影响回显位置。
 */
export function fieldDescriptionSnippet(description, terms, radius = 24) {
    if (description === undefined || description.length === 0)
        return undefined;
    const chars = [...description];
    const foldedChars = [];
    const offsets = [];
    for (let index = 0; index < chars.length; index += 1) {
        const piece = foldFieldText(chars[index]);
        for (let offset = 0; offset < piece.length; offset += 1)
            offsets.push(index);
        foldedChars.push(piece);
    }
    const folded = foldedChars.join('');
    if (folded.length !== offsets.length)
        return undefined;
    for (const term of terms) {
        const foldedTerm = foldFieldText(term);
        if (foldedTerm.length === 0)
            continue;
        const index = folded.indexOf(foldedTerm);
        if (index < 0)
            continue;
        const first = offsets[index];
        const last = offsets[Math.min(index + foldedTerm.length - 1, offsets.length - 1)];
        const start = Math.max(0, first - radius);
        const end = Math.min(chars.length, last + radius + 1);
        const head = chars.slice(start, end).join('');
        return `${start > 0 ? '…' : ''}${head}${end < chars.length ? '…' : ''}`;
    }
    return undefined;
}
export const TAE_FIELD_LABELS = [
    {
        eventTypeId: 760,
        fieldName: 'Reference Distance',
        zh: ['判定距离', '基准距离', '引用距离'],
        semantics: '基准距离：本事件判定时用的参考距离（启用范围必须覆盖它）。'
    },
    {
        eventTypeId: 760,
        fieldName: 'Enable Range Minimum',
        zh: ['判定距离下限', '启用范围下限'],
        semantics: '启用范围下限：与目标的距离小于该值时，本事件不启用。'
    },
    {
        eventTypeId: 760,
        fieldName: 'Enable Range Maximum',
        zh: ['判定距离上限', '启用范围上限'],
        semantics: '启用范围上限：与目标的距离大于该值时，本事件不启用；必须 ≥ Reference Distance，否则事件永远不会启用（TAE_EVENT_UNREACHABLE）。'
    },
    {
        eventTypeId: 760,
        fieldName: 'Enable',
        zh: ['启用本事件'],
        semantics: '是否启用这条 root motion multiplier 事件。'
    },
    {
        eventTypeId: 760,
        fieldName: 'Arrive Dist from Target',
        zh: ['到位距离'],
        semantics: '到达目标时的距离条件。'
    },
    {
        eventTypeId: 760,
        fieldName: 'Arrive Angle from Target',
        zh: ['到位角度'],
        semantics: '到达目标时的角度条件。'
    }
];
export const PARAM_FIELD_LABELS = [
    {
        paramType: 'NPC_PARAM_ST',
        fieldId: 'ninsatuNum',
        // 别名是「同一个字段的另一种叫法」，不是概念触发词：HealthbarNum 是 ESDLang 旧布局名，
        // Amount of healthbars 是 paramdef 英文注解，血条数/忍杀次数是用户口语。
        aliases: ['HealthbarNum', 'Amount of healthbars', '必要忍殺回数', '血条数', '忍杀次数'],
        concepts: ['healthbar-count'],
        semantics: '击杀该 NPC 需要完成的忍杀次数，也就是血条条数（paramdef 英文注解：Amount of healthbars）。'
            + '工作区实测：鬼形部 50800000=3、剑圣一心 54000000=4、破戒僧 50000000=4、杂兵 13600000=0。'
            + '与 EMEVD 的 DisplayMinibossHealthBar / DisplayBossHealthBar 是两件事：那两条指令负责显示血条'
            + '（精英条/Boss 条），不决定条数——工作区里 3 条血的鬼形部事件用 DisplayMinibossHealthBar'
            + '（m11_00 事件 11105800，entity 1100800），4 条血的剑圣一心用 DisplayBossHealthBar'
            + '（m11_02 事件 11125870，entity 1120860）。原版取值未用参考工具核对（Smithbox BUILD_STALE）。'
    }
];
let paramCatalog;
let excludedParamCatalog;
let taeCatalog;
/**
 * 目录条目只由 paramdef 定义生成，是否属于本作由 `inGame` 决定。
 *
 * 分两批建：本作真实存在的表进 {@link paramCatalogEntries}（搜索的唯一来源），
 * 其余进 {@link notInGameParamCatalogEntries}（只用来解释「这个名字为什么没有可读的表」）。
 * 两条路径共用同一套字段/别名/概念投影，所以「排除」不会改变任何字段名的解释，只是不把
 * 不存在的表当候选。
 */
function buildParamCatalogEntries(inGame) {
    const labels = new Map();
    for (const label of PARAM_FIELD_LABELS)
        labels.set(`${label.paramType}:${label.fieldId}`, label);
    const conceptsById = new Map();
    for (const concept of FIELD_CONCEPTS)
        conceptsById.set(concept.id, concept);
    const entries = [];
    for (const definition of FIRST_PARTY_PARAM_METADATA_PACKAGE.definitions) {
        const paramType = definition.key.typeName;
        if (isGameParamTable(paramType) !== inGame)
            continue;
        for (const field of definition.document.fields) {
            const label = labels.get(`${paramType}:${field.id}`);
            // 可检索别名 = 声明的别名 + 指向该字段的概念的触发词。概念触发词（血条/忍杀/deathblow…）
            // 本身就是这个字段的口语叫法，放进别名表后「别名命中」与「概念置顶」走同一条链路，
            // 调用方看到的 matchedTerms 也能解释为什么命中。
            const matchingAliases = label === undefined ? [] : uniqueStrings([
                ...label.aliases,
                ...label.concepts.flatMap((conceptId) => conceptsById.get(conceptId)?.triggers ?? [])
            ]);
            entries.push({
                paramType,
                fieldId: field.id,
                name: field.name ?? field.id,
                type: field.type,
                ...(field.description === undefined ? {} : { description: field.description }),
                foldedId: foldFieldText(field.id),
                foldedName: foldFieldText(field.name ?? field.id),
                foldedDescription: field.description === undefined ? '' : foldFieldText(field.description),
                ...(label === undefined ? {} : {
                    aliases: matchingAliases,
                    semantics: label.semantics
                }),
                foldedAliases: matchingAliases.map(foldFieldText),
                concepts: [...(label?.concepts ?? [])]
            });
        }
    }
    return entries;
}
function paramCatalogEntries() {
    paramCatalog ??= buildParamCatalogEntries(true);
    return paramCatalog;
}
/** paramdef 里有、本作 gameparam 里没有的表；只给「为什么查不到表」的解释用。 */
function notInGameParamCatalogEntries() {
    excludedParamCatalog ??= buildParamCatalogEntries(false);
    return excludedParamCatalog;
}
/** 去重但保留首次出现顺序；别名回显和匹配都依赖这个顺序保持稳定。 */
function uniqueStrings(values) {
    const seen = new Set();
    const kept = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (trimmed.length === 0)
            continue;
        const key = foldFieldText(trimmed);
        if (seen.has(key))
            continue;
        seen.add(key);
        kept.push(trimmed);
    }
    return kept;
}
function taeCatalogEntries() {
    if (taeCatalog !== undefined)
        return taeCatalog;
    const labels = new Map();
    for (const label of TAE_FIELD_LABELS)
        labels.set(`${label.eventTypeId}:${label.fieldName}`, label);
    const merged = new Map();
    for (const bank of FIRST_PARTY_TAE_SCHEMA.banks) {
        for (const event of bank.events) {
            for (const field of event.fields) {
                const key = `${event.id}:${field.name}`;
                const label = labels.get(key);
                const existing = merged.get(key);
                if (existing !== undefined) {
                    if (!existing.banks.includes(bank.name))
                        existing.banks.push(bank.name);
                    continue;
                }
                merged.set(key, {
                    eventTypeId: event.id,
                    eventName: event.name,
                    banks: [bank.name],
                    fieldName: field.name,
                    type: field.type,
                    foldedName: foldFieldText(field.name),
                    foldedEventName: foldFieldText(event.name),
                    // 有的事件变体本身就用中文/日文写字段名（例如 Objects_SDT 的 760 写「基准距离」，
                    // Characters_SDT 的同型事件写英文 Reference Distance）。schema 自带的中文名是
                    // 机械来源，优先级与收录标签相同；收录标签只补 schema 没写中文的那些字段。
                    zh: [...(hasCjk(field.name) ? [field.name] : []), ...(label?.zh ?? [])],
                    ...(label === undefined ? {} : { semantics: label.semantics })
                });
            }
        }
    }
    taeCatalog = [...merged.values()];
    return taeCatalog;
}
/** 拉丁词元的命中强度：整词最强、词边界次之、长词包含最弱。 */
function tokenHit(text, token) {
    if (token.length === 0)
        return 0;
    if (text === token)
        return 3;
    if (new RegExp(`(?:^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:$|[^a-z0-9])`, 'u').test(text))
        return 2;
    if (token.length >= 4 && text.includes(token))
        return 1;
    return 0;
}
function clampLimit(value) {
    if (value === undefined || !Number.isFinite(value))
        return 8;
    return Math.max(1, Math.min(32, Math.trunc(value)));
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
export function searchParamFieldCatalog(query, options = {}) {
    const expanded = expandFieldQuery(query);
    if (expanded.matchTerms.length === 0)
        return [];
    const requestedTable = options.table === undefined || options.table.trim() === '' ? undefined : options.table.trim();
    const tableType = requestedTable === undefined ? undefined : resolveGameParamTable(requestedTable);
    if (requestedTable !== undefined && tableType === undefined)
        return [];
    const hits = collectParamHits(paramCatalogEntries(), expanded, tableType);
    return rankParamHits(hits, options.limit);
}
/**
 * paramdef 语料里有、但本作 gameparam 里没有对应表的字段。
 *
 * 这不是「候选」：调用方不能用它去读/写字段。它只解释一件事——「AI_ATTACK_PARAM_ST
 * 有 successDistance」这种说法来自 paramdef 类型字典，游戏容器里没有这张表，所以
 * 顺着它找「追斩距离」是死路。返回结构与 {@link searchParamFieldCatalog} 一致，
 * 让调用方可以原样回显 table/fieldId。
 */
export function searchParamFieldCatalogNotInGame(query, options = {}) {
    const expanded = expandFieldQuery(query);
    if (expanded.matchTerms.length === 0)
        return [];
    const requested = options.table === undefined || options.table.trim() === '' ? undefined : options.table.trim();
    // 显式点名一张本作没有的表时，只要那张表的字段；否则在本作没有的所有表里搜。
    const requestedType = requested === undefined ? undefined : resolveGameParamTable(requested) ?? requested;
    const hits = collectParamHits(notInGameParamCatalogEntries(), expanded, requestedType);
    return rankParamHits(hits, options.limit);
}
/** 本作 gameparam 实际存在的 PARAM 表数量（不是 paramdef 类型数）。 */
export function gameParamTableCount() {
    return SEKIRO_GAME_PARAM_TABLES.length;
}
/**
 * 把一个 `table` 拼写解析成「是不是本作的表」的确定答案。
 *
 * 三种结果必须能分开，否则工具只能把两种失败混成同一句空结果：
 *   · `inGame`：本作 gameparam 里有这张表（`paramType` 是它的 native 类型名）；
 *   · `inParamdef: true` 但 `inGame: false`：只在随包 paramdef 里定义，本作没有子文件；
 *   · 两个都 false：连 paramdef 都没这个类型（拼错或根本不是 PARAM 表）。
 */
export function describeTableSpelling(spelling) {
    const inGameType = resolveGameParamTable(spelling);
    if (inGameType !== undefined) {
        return { requested: spelling, paramType: inGameType, inGame: true, inParamdef: true };
    }
    const wanted = tableKey(spelling);
    const definition = FIRST_PARTY_PARAM_METADATA_PACKAGE.definitions
        .find((candidate) => tableKey(candidate.key.typeName) === wanted);
    return {
        requested: spelling,
        ...(definition === undefined ? {} : { paramType: definition.key.typeName }),
        inGame: false,
        inParamdef: definition !== undefined
    };
}
function collectParamHits(entries, expanded, tableType) {
    const hits = [];
    for (const entry of entries) {
        if (tableType !== undefined && entry.paramType !== tableType)
            continue;
        const match = classifyFieldMatch({
            fieldId: entry.fieldId,
            name: entry.name,
            ...(entry.description === undefined ? {} : { description: entry.description }),
            ...(entry.aliases === undefined ? {} : { aliases: entry.aliases })
        }, expanded.matchTerms, { preferCjkTerms: expanded.hasCjk, wholeQuery: expanded.normalizedQuery });
        if (match === undefined)
            continue;
        // 收录字段的两种置顶信号，优先级高于任何词元巧合：
        //   1. 查询命中该字段声明的概念（血条数 → healthbar-count → NpcParam.ninsatuNum）；
        //   2. 查询整句等于一个收录别名（HealthbarNum / Amount of healthbars / 血条数）。
        // 没有这一档时，`ninsatuNum` 只能靠 id 里的 ninsatu 词元命中，分数低于 hp 而被挤到第 7 位。
        const conceptHit = entry.concepts.some((concept) => expanded.conceptIds.includes(concept));
        const aliasHit = entry.foldedAliases.includes(expanded.normalizedQuery);
        const curatedBoost = aliasHit ? 520 : conceptHit ? 420 : 0;
        const score = scoreCatalogMatch(match, entry.foldedId, entry.foldedName, expanded) + curatedBoost;
        const snippet = match.matchedField === 'description'
            ? fieldDescriptionSnippet(entry.description, match.matchedTerms)
            : undefined;
        hits.push({
            entry,
            candidate: {
                domain: 'param',
                matchedBy: match.matchedBy,
                matchedField: match.matchedField,
                matchKind: matchKindOf(match, entry.foldedName, expanded.normalizedQuery),
                matchedTerms: match.matchedTerms.slice(0, 6),
                score,
                name: entry.name,
                type: entry.type,
                ...(entry.description === undefined ? {} : { description: entry.description }),
                ...(snippet === undefined ? {} : { descriptionSnippet: snippet }),
                table: entry.paramType,
                paramType: entry.paramType,
                fieldId: entry.fieldId,
                ...(entry.aliases === undefined ? {} : { aliases: entry.aliases }),
                ...(entry.semantics === undefined ? {} : { semantics: entry.semantics })
            }
        });
    }
    return hits;
}
function rankParamHits(hits, limit) {
    hits.sort((left, right) => right.candidate.score - left.candidate.score
        || left.entry.fieldId.length - right.entry.fieldId.length
        || left.entry.fieldId.localeCompare(right.entry.fieldId));
    return hits.slice(0, clampLimit(limit)).map((hit) => hit.candidate);
}
/** 在 TAE 事件字段目录里找字段。收录字段的中文标签优先级最高。 */
export function searchTaeFieldCatalog(query, options = {}) {
    const expanded = expandFieldQuery(query);
    if (expanded.matchTerms.length === 0)
        return [];
    const hits = [];
    for (const entry of taeCatalogEntries()) {
        const match = classifyFieldMatch({
            name: entry.fieldName,
            cjkLabels: entry.zh
        }, expanded.matchTerms, { preferCjkTerms: expanded.hasCjk });
        if (match === undefined)
            continue;
        // 整句命中中文标签（收录标签或 schema 自带的中文名）是最强信号：用户说的就是这个字段。
        // 只按「命中了某一列」排序不够——`Reference Distance` 同时被 distance 词元命中，
        // 会被同分的其他 distance 字段挤下去，于是「判定距离」答不出大家真正想找的两个字段。
        const wholeLabelHit = expanded.normalizedQuery.length >= 2
            && entry.zh.some((label) => {
                const foldedLabel = foldFieldText(label);
                return foldedLabel.length > 0 && foldedLabel.includes(expanded.normalizedQuery);
            });
        let score = scoreCatalogMatch(match, '', entry.foldedName, expanded);
        if (wholeLabelHit)
            score += 300;
        else if (match.matchedField === 'cjk-label')
            score += 260;
        // 事件名命中只作为弱信号，用来把「root motion」这类动作层问句排到前面。
        for (const token of expanded.coverageTerms) {
            const eventHit = tokenHit(entry.foldedEventName, foldFieldText(token));
            if (eventHit > 0)
                score += eventHit === 3 ? 20 : 6;
        }
        const channel = wholeLabelHit
            ? { matchedBy: 'cjk-variant', matchedField: 'cjk-label' }
            : match;
        hits.push({
            entry,
            candidate: {
                domain: 'tae',
                matchedBy: channel.matchedBy,
                matchedField: channel.matchedField,
                matchKind: matchKindOf(channel, entry.foldedName, expanded.normalizedQuery),
                matchedTerms: match.matchedTerms.slice(0, 6),
                score,
                name: entry.fieldName,
                type: entry.type,
                eventTypeId: entry.eventTypeId,
                eventName: entry.eventName,
                banks: [...entry.banks],
                ...(entry.semantics === undefined ? {} : { semantics: entry.semantics })
            }
        });
    }
    hits.sort((left, right) => right.candidate.score - left.candidate.score
        || left.entry.fieldName.length - right.entry.fieldName.length
        || left.entry.fieldName.localeCompare(right.entry.fieldName)
        || left.entry.eventTypeId - right.entry.eventTypeId);
    return hits.slice(0, clampLimit(options.limit)).map((hit) => hit.candidate);
}
function matchKindOf(match, foldedName, normalizedQuery) {
    if (match.matchedField === 'cjk-label' || match.matchedField === 'alias')
        return 'curated-label';
    if (match.matchedField === 'description')
        return 'description';
    if (match.matchedBy === 'fieldId')
        return 'field-id';
    return foldedName.length > 0 && foldedName === normalizedQuery ? 'exact-name' : 'field-name';
}
function scoreCatalogMatch(match, foldedId, foldedName, expanded) {
    // 中文标签的分数在调用方按「整句命中 / 词元命中」两档加，这里只算字段名与 id 的形状分。
    let score = 0;
    for (const term of expanded.matchTerms) {
        const foldedTerm = foldFieldText(term);
        const idHit = tokenHit(foldedId, foldedTerm);
        const nameHit = tokenHit(foldedName, foldedTerm);
        if (idHit > 0)
            score += [0, 50, 100, 120][idHit];
        if (nameHit > 0)
            score += [0, 50, 70, 120][nameHit];
        if (foldedName.includes(foldedTerm))
            score += 4;
    }
    // 整句精确等于字段名时直接置顶（'Reference Distance' 这类英文全名查询）。
    if (foldedName.length > 0 && foldedName === expanded.normalizedQuery)
        score += 200;
    // 整句精确等于 fieldId 同样置顶：查询 ninsatuNum 是「我要这个字段」，不该被 id 更短的
    // hp 用同分+长度排序挤下去。命中通道仍是 fieldId，这里只改排序。
    if (foldedId.length > 0 && foldedId === expanded.normalizedQuery)
        score += 200;
    return score;
}
/** 跨域一次查：TAE 在前（动作层问句更常见），PARAM 在后。 */
export function searchFieldVocabulary(query, options = {}) {
    const domain = options.domain ?? 'all';
    const limit = clampLimit(options.limit);
    if (domain === 'param')
        return searchParamFieldCatalog(query, { ...options, limit });
    if (domain === 'tae')
        return searchTaeFieldCatalog(query, { limit });
    const tae = searchTaeFieldCatalog(query, { limit });
    if (tae.length >= limit)
        return tae;
    const param = searchParamFieldCatalog(query, { ...options, limit: limit - tae.length });
    return [...tae, ...param];
}
/** 目录规模，供工具的 provenance 回显；数字来自随包 schema，不手写常量。 */
export function fieldCatalogStats() {
    let taeEventTypes = 0;
    let taeFields = 0;
    for (const bank of FIRST_PARTY_TAE_SCHEMA.banks) {
        for (const event of bank.events) {
            taeEventTypes += 1;
            taeFields += event.fields.length;
        }
    }
    return {
        // paramDefinitions 是 paramdef 类型字典的规模，paramGameTables 是本作容器里真实存在的表数。
        // 两个数必须分开回显：只报前者会让调用方以为 160 张表都能读。
        paramDefinitions: FIRST_PARTY_PARAM_METADATA_PACKAGE.definitions.length,
        paramGameTables: gameParamTableCount(),
        paramDefinitionsNotInGame: FIRST_PARTY_PARAM_METADATA_PACKAGE.definitions.length - gameParamTableCount(),
        paramFields: paramCatalogEntries().length,
        taeEventTypes,
        taeFields,
        curatedLabels: TAE_FIELD_LABELS.length,
        curatedParamFields: PARAM_FIELD_LABELS.length
    };
}
/**
 * 两个目录里出现过的字段名（去重，保留第一个所属表/事件）。
 * 只给零命中时的「最接近」用；不是一次完整枚举，调用方不要拿它当字段清单。
 */
export function fieldCatalogNames(limit = 24_000) {
    const names = [];
    const seen = new Set();
    for (const entry of paramCatalogEntries()) {
        if (names.length >= limit)
            return names;
        if (seen.has(entry.fieldId))
            continue;
        seen.add(entry.fieldId);
        names.push({ domain: 'param', fieldId: entry.fieldId, name: entry.name, table: entry.paramType, paramType: entry.paramType });
    }
    for (const entry of taeCatalogEntries()) {
        if (names.length >= limit)
            return names;
        const key = `tae:${entry.fieldName}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        names.push({ domain: 'tae', name: entry.fieldName, table: entry.eventName });
    }
    return names;
}
/**
 * 零命中时的「最接近」候选：不猜语义，只按用字/拼写接近程度给下一步。
 *
 * CJK 查询用等长单字替换（和 search_text_entries 的 variantHints 同一套），
 * 拉丁查询用「同 token 前缀/包含」近似；两种都只返回数据原文里的字段名。
 */
export function nearestFieldCandidates(query, candidates, limit = 5) {
    if (candidates.length === 0 || limit <= 0)
        return [];
    const foldedQuery = foldFieldText(query);
    if (foldedQuery.length === 0)
        return [];
    const scored = [];
    const seen = new Set();
    const push = (item, score, reason) => {
        const key = `${item.table ?? item.paramType ?? ''}:${item.fieldId ?? item.name}`;
        if (seen.has(key))
            return;
        seen.add(key);
        scored.push({ item, score, reason });
    };
    for (const item of candidates) {
        const foldedName = foldFieldText(item.name);
        const foldedId = item.fieldId === undefined ? '' : foldFieldText(item.fieldId);
        const queryChars = [...foldedQuery];
        const nameChars = [...foldedName];
        let shared = 0;
        for (const char of new Set(queryChars))
            if (nameChars.includes(char))
                shared += 1;
        const coverage = shared / Math.max(1, new Set(queryChars).size);
        if (foldedName === foldedQuery)
            push(item, 100, '字段名与查询完全一致');
        else if (foldedName.includes(foldedQuery) || (foldedId.length > 0 && foldedId.includes(foldedQuery))) {
            push(item, 80, '字段名包含查询');
        }
        else if (coverage >= 0.5 && queryChars.length >= 2 && hasCjk(query)) {
            push(item, Math.round(coverage * 60), '字段名与查询共用的字最多');
        }
        else if (foldedId.length > 0 && foldedId.includes(foldedQuery.slice(0, Math.min(4, foldedQuery.length)))) {
            push(item, 40, 'fieldId 前缀接近');
        }
    }
    scored.sort((left, right) => right.score - left.score
        || left.item.name.length - right.item.name.length
        || left.item.name.localeCompare(right.item.name));
    return scored.slice(0, limit).map((entry) => ({
        ...(entry.item.fieldId === undefined ? {} : { fieldId: entry.item.fieldId }),
        name: entry.item.name,
        ...(entry.item.table === undefined ? {} : { table: entry.item.table }),
        ...(entry.item.paramType === undefined ? {} : { paramType: entry.item.paramType }),
        reason: entry.reason
    }));
}
//# sourceMappingURL=fieldSemantics.js.map