/**
 * S10 引用框选的数据契约（PARAM 先行）。
 *
 * 框选 = 与带 `data-cite` 的 DOM 做矩形相交，再从工作台状态拼逻辑引用
 * （用户裁定 2026-08-16：不要 OCR、不要截图像素识别）。本模块是 renderer 与
 * main 共用的纯逻辑：
 *  - `CiteHit`：工作台 DOM 上 `data-cite` 的 JSON 内容（只含逻辑 id，禁止绝对
 *    路径；renderer 拼、main 解码校验后不信任 renderer 的合法性）。
 *  - `decodeCiteHit` / `decodeCiteHits`：main（IPC 边界）与测试共用的解码器，
 *    拒绝绝对路径、非法 kind、非数字行 id、空标识符。
 *  - `mergeCiteHits`：一次框选把「一行 + N 个字段」合并成一条引用（跨表/跨行
 *    不合并——一次框选一条 chip，可多次点「引用」累加）。
 *  - `formatParamCiteLabel`：固定可见标签
 *    `param/<库短名>/<表名>/<行id>-<行名>【<字段中文>：<值>】…`，
 *    字段按框中的字段列出，框中只有行则只到行名。
 *
 * 安全边界：本模块不接触磁盘、不携带绝对路径；「renderer 仍不能读盘」不因引用
 * 框选而改变——label/value 只是 renderer 已显示内容的只读副本，main 校验的是
 * 结构与标识符。
 */
/** 一次框选命中的可引用节点（data-cite 的 JSON 值）。 */
export type CiteHit = {
    kind: 'param-row';
    library: string;
    table: string;
    rowId: number;
    name?: string;
} | {
    kind: 'param-field';
    library: string;
    table: string;
    rowId: number;
    fieldId: string;
    label: string;
    value: string;
} | {
    /** S10 扩展：FMG 条目行。table 用 typed tableId（stableId，含冒号是合法的）。 */
    kind: 'text-entry';
    library: string;
    table: string;
    entryId: number;
    text?: string;
} | {
    /** S10 扩展：EMEVD 脚本文档（源码区）。script 用逻辑 URI（tabId）。 */
    kind: 'event-script';
    library: string;
    script: string;
    label: string;
};
/** 一次框选合并后的单条引用（param 行 + 字段子集 / 文本条目 / 事件脚本）。 */
export type Citation = ParamCitation | {
    kind: 'text';
    library: string;
    table: string;
    entryId: number;
    text?: string;
} | {
    kind: 'event';
    library: string;
    script: string;
    label: string;
};
/** param 引用：一行 + 其命中的字段子集（S10 拍死形态）。 */
export interface ParamCitation {
    kind: 'param';
    library: string;
    table: string;
    rowId: number;
    rowName?: string;
    fields: Array<{
        fieldId: string;
        label: string;
        value: string;
    }>;
}
/** 解码单条 data-cite 命中；格式非法 / 含路径 / 标识符非法时抛错（main 拒收）。 */
export declare function decodeCiteHit(raw: unknown): CiteHit;
/** 解码整批框选命中（空数组视为非法——空框选不产生引用）。 */
export declare function decodeCiteHits(value: unknown): CiteHit[];
/**
 * 把一次框选的命中合并成一条引用。
 *
 * param 锚定策略（S10 拍死「一次框选一条 chip」）：字段命中锚定行——字段栏永远显示
 * **选中行**的字段，框里扫到的其他行（同表不同 rowId）是误框，丢弃不并入；
 * 无字段命中时取第一行。跨表字段/行（当前 UI 不会出现，防御性处理）同样按
 * 锚定的 library+table+rowId 过滤。同字段去重（框选重叠时同一字段命中多次）。
 *
 * S10 扩展：text-entry / event-script 命中各自成一条（文本条目行、事件脚本
 * 文档都是单节点粒度，无行/字段合并）；同 key 重复命中（框选重叠）去重。
 * 混合 kind 的框选（正常 UI 不会出现）取第一组，不跨 kind 合并。
 * 没有任何可引用命中时返回 null（「这块还不能引用」）。
 */
export declare function mergeCiteHits(hits: readonly CiteHit[]): Citation | null;
/**
 * 引用的固定可见标签：
 * - param：`param/<库短名>/<表名>/<行id>-<行名>【<字段中文>：<值>】…`
 * - text：`text/<库>/<表>/<条目id>`
 * - event：`event/<库>/<脚本>`（label 是短名）
 * 库短名用 `gameparam` 这类逻辑名，绝不出 `D:\...`。
 */
export declare function formatCitationLabel(citation: Citation): string;
/**
 * 引用的固定可见标签（S10 拍死格式）：
 * `param/<库短名>/<表名>/<行id>-<行名>【<字段中文>：<值>】…`
 * 字段按框中的字段列出；框中只有行则只到行名。库短名用 `gameparam` 这类逻辑名，
 * 绝不出 `D:\...`。
 */
export declare function formatParamCiteLabel(citation: ParamCitation): string;
