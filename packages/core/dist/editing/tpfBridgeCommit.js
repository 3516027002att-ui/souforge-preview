/**
 * TPF Bridge stage helpers（TEXTURE-52C）— writers only touch staging; callers commit via Patch Engine.
 *
 * 与 gparamBridgeCommit/fmgBridgeCommit 同一范式：渲染器/调用方给出 typed
 * texture replace（textureIndex + 新纹理 DDS 的 base64），main 侧经 Patch Engine
 * 的 outer stage 落到暂存区，由 write-tpf-texture-replace 重读验证后才进入 Patch。
 *
 * 不提供「通用 bytes replace fallback」：没有 typed 定位就没有写入口。
 * 替换 DDS 的 dimensions/format/color-space/mipmap 必须与目标纹理一致，
 * 否则 C# 侧失败关闭（TPF_STAGING_WRITE_FAILED），不会静默写坏。
 */
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
export async function commitTpfTextureReplaceViaBridge(request) {
    const result = await runBridge({
        command: 'write-tpf-texture-replace',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        timeoutMs: request.timeoutMs ?? 60_000,
        ...(request.oodleRuntimeRoot ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
        commandOptions: {
            outputPath: request.outputPath,
            expectedDocumentHash: request.expectedDocumentHash,
            textureIndex: request.replace.textureIndex,
            newTextureBase64: request.replace.newTextureBase64
        }
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.tpf);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.outputSize !== undefined ? { outputSize: result.data.outputSize } : {}),
        ...(result.data?.dataSizeAfter !== undefined ? { dataSizeAfter: result.data.dataSizeAfter } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
//# sourceMappingURL=tpfBridgeCommit.js.map