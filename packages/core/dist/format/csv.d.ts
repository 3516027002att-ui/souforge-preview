/**
 * 极简 CSV 读写（T5-4 PARAM 导入导出）。
 *
 * 只支持 RFC 4180 的最小必要子集：逗号分隔、双引号包裹含分隔符/引号/换行的字段、
 * 双引号转义（`""`）。不处理 CR 内部的嵌入换行以外的边界 —— PARAM 的 CSV 由
 * 本应用自己生成，字段值要么是数字要么是单行文本，外部导入的畸形文件按行容错。
 *
 * 刻意不引第三方库：CSV 是常见的注入面（公式注入、字段膨胀），自家小实现 +
 * 单测覆盖比拉进一个生态库更可控。
 */
/**
 * 把行数组编码成 CSV 文本。每行字段数应一致（不强校验，交给调用方语义）。
 */
export declare function toCsvText(headers: string[], rows: Array<Array<string>>): string;
/**
 * 解析 CSV 文本为「表头 + 数据行」。
 *
 * 容错：行内字段数不一致时丢弃多余字段；整行解析失败（引号未闭合）跳过该行并
 * 记诊断。返回结构化结果而不是抛异常 —— 导入路径要能「部分成功」。
 */
export declare function parseCsvText(text: string): {
    ok: true;
    headers: string[];
    rows: Array<string[]>;
    skipped: number;
};
