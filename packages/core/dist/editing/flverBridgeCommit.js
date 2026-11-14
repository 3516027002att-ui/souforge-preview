/**
 * FLVER Bridge stage helpers — writers only touch staging; callers commit via Patch Engine.
 *
 * MODEL-51C：flver-material-slot-set typed mutation 的写链提交入口。
 * 写命令是 write-flver，成功判据与 fmg/param/emevd/msb 一样：诊断里出现
 * BRIDGE_STAGING_WRITE_VERIFIED_CODES.flver（FLVER_STAGING_WRITE_VERIFIED）。
 * 调用方是 editorMutationService 的 applyNativeMutation（stageWrite），
 * 资源最终落盘仍走 Patch Engine 事务，writer 只写暂存区。
 */
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
export async function commitFlverMutationViaBridge(request) {
    const commandOptions = {
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        mutations: [
            {
                kind: request.mutation.kind,
                meshStableId: request.mutation.meshStableId,
                slotIndex: request.mutation.slotIndex,
                materialStableId: request.mutation.materialStableId
            }
        ]
    };
    if (request.entryIndex !== undefined) {
        commandOptions.entryIndex = request.entryIndex;
    }
    const result = await runBridge({
        command: 'write-flver',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        timeoutMs: request.timeoutMs ?? 60_000,
        commandOptions
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.flver);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.meshCount !== undefined ? { meshCount: result.data.meshCount } : {}),
        ...(result.data?.storageProfile ? { storageProfile: result.data.storageProfile } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
//# sourceMappingURL=flverBridgeCommit.js.map