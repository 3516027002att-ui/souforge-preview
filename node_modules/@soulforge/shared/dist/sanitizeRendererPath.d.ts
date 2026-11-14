/** 渲染器可见文案里的本机路径占位符。 */
export declare const HIDDEN_PATH_PLACEHOLDER = "[\u672C\u673A\u8DEF\u5F84\u5DF2\u9690\u85CF]";
/**
 * 只打码路径跨度，前后中文留下。整串就是盘符/UNC/打包机路径时整串换成占位符。
 * `file:///workspace/a.fmg` 这类相对 URI 原样保留。
 */
export declare function maskAbsolutePathSpans(value: string): string;
