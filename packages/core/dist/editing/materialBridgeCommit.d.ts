/**
 * MTD Bridge stage helpers（MATERIAL-53C）— writers only touch staging; callers commit via Patch Engine.
 *
 * 与 tpfBridgeCommit/gparamBridgeCommit 同一范式：调用方给出 typed material
 * property set（paramId + newValue），main 侧经 Patch Engine 的 outer stage 落到
 * 暂存区，由 write-mtd-document 重读验证后才进入 Patch。
 *
 * 不提供「通用 XML 文本替换 fallback」：没有 typed 定位就没有写入口。
 * 目标 param 的文本内容区间含任何 XML 标记时 C# 侧 fail-closed
 * （MTD_WRITE_BLOCKED_UNKNOWN_STRUCTURE），不静默写坏。字节外科替换保证目标
 * param 文本之外的一切字节（含未知元素/属性/注释/CDATA）无损保留。
 *
 * 注意：MTD 是 mtdbnd.dcx 容器内子项。本层只处理 loose 子项（sourcePath 指向
 * 已提取的裸 .mtd）；容器外层重建由 Patch Engine 在 main 侧完成。sourcePath 若
 * 直接指向 .mtd.dcx，C# writer 同样支持（解压→改→按原压缩格式重建）。
 */
/** typed material property set：把 MTD 里 id=paramId 的 param 文本值改为 newValue。 */
export interface MtdPropertySetRequest {
    /** 目标 param 的 id（与 read envelope 的 properties[i].id 一致）。 */
    paramId: string;
    /** 新文本值（与 read 侧 value 同语义：trimmed；允许空串表示清空）。 */
    newValue: string;
}
export interface MtdBridgeCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    set: MtdPropertySetRequest;
    /** .mtd.dcx 源的 Oodle 运行库根（KRAK 压缩需要；DFLT 不需要）。 */
    oodleRuntimeRoot?: string;
    timeoutMs?: number;
}
export interface MtdBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    outputSize?: number;
    paramName?: string;
    valueBefore?: string;
    valueAfter?: string;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export declare function commitMtdPropertySetViaBridge(request: MtdBridgeCommitRequest): Promise<MtdBridgeCommitResult>;
