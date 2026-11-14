import { TRADITIONAL_TO_SIMPLIFIED_PAIRS } from './cjkFoldTable.js';
/**
 * 繁简/异体折叠：只影响「匹配」，绝不改写返回的原文。
 *
 * 第 43 轮盲测：用户写「靛藍」（繁体），数据写「靛蓝」（简体），search_text_entries 返回 0
 * 并且不提示“可能是用字不同”。此前只有一张手写的 ~90 字表（SEARCH_CHAR_FOLDS），覆盖不到
 * 藍/龍/覺/繡，于是同一类缺陷在每一批新字上复发。这是唯一一类“用户表达正确、数据存在、
 * 但工具答没有”的缺陷，而且用户无法自己发现原因。
 *
 * 策略与取舍：
 * - 只做繁→简一个方向。反方向必须把简体数据改写成繁体的匹配形，数据和查询都要改写，
 *   精确命中的分数与排序会跟着失真；方向单一也保证“数据原文永远不被写回”。
 * - NFKC 先归一兼容字形（全角、康熙部首、兼容汉字），再折叠。两步都只发生在匹配形上。
 * - 没有词典依赖：表是 Unihan kSimplifiedVariant 生成的静态数据（见 cjkFoldTable.ts），
 *   随包发布，不联网、不引库。
 */
let foldMap = null;
let foldPattern = null;
function foldTable() {
    if (foldMap === null || foldPattern === null) {
        const map = new Map();
        for (const pair of TRADITIONAL_TO_SIMPLIFIED_PAIRS) {
            for (let index = 0; index + 1 < pair.length; index += 2) {
                map.set(pair[index], pair[index + 1]);
            }
        }
        foldMap = map;
        // 一个字面量字符类一次扫完整串：不含繁体字时是原生扫描，不逐字进 JS。
        foldPattern = new RegExp(`[${[...map.keys()].join('')}]`, 'gu');
    }
    return { map: foldMap, pattern: foldPattern };
}
/** 繁→简折叠。没有需要折叠的字时原样返回（replace 无命中不做拷贝）。 */
export function foldCjkVariants(value) {
    if (value.length === 0)
        return value;
    const { map, pattern } = foldTable();
    return value.replace(pattern, (character) => map.get(character) ?? character);
}
/** 匹配用的规范形：NFKC（全角/兼容字形）→ 繁→简。查询与数据必须走同一条路。 */
export function normalizeCjkMatchForm(value) {
    return foldCjkVariants(value.normalize('NFKC'));
}
/**
 * 零命中时的「用字可能不同」候选：等长、只有一个字不同。
 *
 * 比的是折叠后的字，所以繁简差异不算“不同”——那类差异已经由 foldCjkVariants 吃掉，
 * 剩下的典型形态是同音字、形近字、以及折叠表覆盖不到的异体（例如数据写「锈丸」、
 * 用户写「绣丸」：绣/锈都不是彼此的繁简，任何繁简表都救不了）。这里用纯等长替换扫描 +
 * 共有字/共同前后缀排序，不带词典、不带拼音表：宁可少给候选，也不编造语义相似。
 */
export function nearestByCharacterSubstitution(query, candidates, limit, 
/** 候选在工作区里出现的次数。同分时用它把真正在用的写法排到前面（0 命中查询才付这个成本）。 */
frequency) {
    if (limit <= 0)
        return [];
    const target = [...normalizeCjkMatchForm(query)];
    if (target.length < 2 || !/[\u3400-\u9fff]/u.test(query))
        return [];
    const found = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (typeof candidate !== 'string' || candidate.length === 0 || seen.has(candidate))
            continue;
        const chars = [...normalizeCjkMatchForm(candidate)];
        if (chars.length !== target.length)
            continue;
        let differences = 0;
        let shared = 0;
        for (let index = 0; index < chars.length; index += 1) {
            if (foldCjkVariants(chars[index]) === target[index])
                shared += 1;
            else
                differences += 1;
        }
        if (differences !== 1)
            continue;
        let prefix = 0;
        while (prefix < chars.length && chars[prefix] === target[prefix])
            prefix += 1;
        let suffix = 0;
        while (suffix < chars.length - prefix && chars[chars.length - 1 - suffix] === target[target.length - 1 - suffix])
            suffix += 1;
        seen.add(candidate);
        found.push({ text: candidate, shared, prefix, suffix });
    }
    found.sort((left, right) => right.shared - left.shared || right.prefix - left.prefix
        || right.suffix - left.suffix || left.text.localeCompare(right.text));
    // 只对最短名单算频次：2 字查询的等长候选可能很多，全量算一次就要扫整个语料。
    const shortlist = found.slice(0, Math.max(32, limit * 4));
    if (frequency !== undefined) {
        const weights = new Map(shortlist.map((item) => [item.text, frequency(item.text)]));
        shortlist.sort((left, right) => (weights.get(right.text) - weights.get(left.text))
            || right.prefix - left.prefix || right.suffix - left.suffix || left.text.localeCompare(right.text));
    }
    return shortlist.slice(0, limit).map((item) => item.text);
}
//# sourceMappingURL=cjkVariants.js.map