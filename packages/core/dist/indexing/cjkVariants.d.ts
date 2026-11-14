/** 繁→简折叠。没有需要折叠的字时原样返回（replace 无命中不做拷贝）。 */
export declare function foldCjkVariants(value: string): string;
/** 匹配用的规范形：NFKC（全角/兼容字形）→ 繁→简。查询与数据必须走同一条路。 */
export declare function normalizeCjkMatchForm(value: string): string;
/**
 * 零命中时的「用字可能不同」候选：等长、只有一个字不同。
 *
 * 比的是折叠后的字，所以繁简差异不算“不同”——那类差异已经由 foldCjkVariants 吃掉，
 * 剩下的典型形态是同音字、形近字、以及折叠表覆盖不到的异体（例如数据写「锈丸」、
 * 用户写「绣丸」：绣/锈都不是彼此的繁简，任何繁简表都救不了）。这里用纯等长替换扫描 +
 * 共有字/共同前后缀排序，不带词典、不带拼音表：宁可少给候选，也不编造语义相似。
 */
export declare function nearestByCharacterSubstitution(query: string, candidates: Iterable<string>, limit: number, 
/** 候选在工作区里出现的次数。同分时用它把真正在用的写法排到前面（0 命中查询才付这个成本）。 */
frequency?: (candidate: string) => number): string[];
