/**
 * 繁→简折叠表：每个元素是「繁 + 简」两个 UTF-16 单元，逐 10 对一行。
 *
 * 来源：Unicode Unihan_Variants.txt 的 kSimplifiedVariant（U+4E00–U+9FFF 内的单字对，
 * 源与目标都在基本汉字区，去掉恒等对，每个源字取第一个目标），共 2680 对。
 * 这是随包发布的静态数据，不是运行时依赖：没有网络请求，也不引入词典库。
 * 只做繁→简一个方向——反方向会把简体数据改写成繁体，精确命中的分数与排序都会失真。
 *
 * 改这张表要连带跑 cjkVariants.test.ts：只加不删字对是安全的，删字对会让繁简召回静默回退。
 */
export declare const TRADITIONAL_TO_SIMPLIFIED_PAIRS: readonly string[];
