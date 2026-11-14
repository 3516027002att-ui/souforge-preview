/**
 * S13：FMG 表逻辑名投影（renderer 安全，纯字符串函数）。
 *
 * Bridge `read-text-catalog` 的表 `entryName` 是 BND4 内层原名，可含原构建机
 * 绝对路径（如 `N:\GR\data\INTERROOT_win64\msg\zhocn\Title_Items.fmg`）。
 * 主进程在出 renderer 前投影为逻辑表名：取 basename、去 `.fmg` 扩展；同名表按
 * 序号追加 `#N` 保持可区分。renderer 永不把 `[本机路径已隐藏]` 当表名显示。
 *
 * 使用方：main ipc `readTextCatalog`（生产投影）、e2e fixture（同语义替身）。
 */
export declare function logicalFmgTableName(rawName: string, index: number, seen: Set<string>): string;
