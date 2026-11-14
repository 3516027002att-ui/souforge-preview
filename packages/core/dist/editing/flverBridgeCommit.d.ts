/**
 * FLVER Bridge stage helpers — writers only touch staging; callers commit via Patch Engine.
 *
 * MODEL-51C：flver-material-slot-set typed mutation 的写链提交入口。
 * 写命令是 write-flver，成功判据与 fmg/param/emevd/msb 一样：诊断里出现
 * BRIDGE_STAGING_WRITE_VERIFIED_CODES.flver（FLVER_STAGING_WRITE_VERIFIED）。
 * 调用方是 editorMutationService 的 applyNativeMutation（stageWrite），
 * 资源最终落盘仍走 Patch Engine 事务，writer 只写暂存区。
 */
/** 单个 FLVER 材质槽写回 mutation。stable ID 形态与 renderer 侧一致：mesh:N / material:N。 */
export interface FlverMaterialSlotSetMutation {
    kind: 'material-slot-set';
    meshStableId: string;
    /** FLVER mesh 只有一个材质槽；渲染端恒为 0，C# 侧对非 0 值 fail-closed。 */
    slotIndex: number;
    materialStableId: string;
}
export interface FlverBridgeCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutation: FlverMaterialSlotSetMutation;
    /** chrbnd/DCX 容器写：FLVER 在 BND4 里的 child 下标。缺省 = loose profile。 */
    entryIndex?: number;
    timeoutMs?: number;
}
export interface FlverBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    meshCount?: number;
    storageProfile?: 'loose' | 'chrbnd';
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export declare function commitFlverMutationViaBridge(request: FlverBridgeCommitRequest): Promise<FlverBridgeCommitResult>;
