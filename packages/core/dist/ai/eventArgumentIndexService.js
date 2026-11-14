import { readFullEmevdDocumentViaBridge } from '../editing/emevdFullDocument.js';
import { loadFirstPartyEmedfRegistry } from '../schema/sekiro/firstPartySchema.js';
import { isActiveSemanticSource } from '../workspace/resourceKinds.js';
import { eventMapIdFromSourceUri, getEventInstructionIndex } from '../references/eventInstructionIndex.js';
/** 只保留真正的 EMEVD 语义源；`.bak`、缓存、投影文件不进入索引。 */
export function workspaceEventInstructionFiles(ws) {
    return ws.getFiles()
        .filter((file) => file.resourceKind === 'event')
        .filter((file) => /\.emevd(?:\.dcx)?$/iu.test(file.relativePath || file.absolutePath))
        .filter((file) => isActiveSemanticSource(file))
        .map((file) => {
        const mapId = eventMapIdFromSourceUri(file.sourceUri) ?? eventMapIdFromSourceUri(file.relativePath);
        return {
            sourceUri: file.sourceUri,
            absolutePath: file.absolutePath,
            ...(mapId ? { mapId } : {}),
            size: file.size,
            mtimeMs: file.mtimeMs
        };
    });
}
export async function loadWorkspaceEventInstructionIndex(input) {
    const registry = loadFirstPartyEmedfRegistry();
    if (!registry.ok || !registry.registry) {
        return {
            ok: false,
            code: 'EMEDF_REGISTRY_UNAVAILABLE',
            message: registry.diagnostics[0]?.message ?? '内置 EMEVD schema 不可用，无法解码事件参数。',
            diagnostics: registry.diagnostics
        };
    }
    const files = workspaceEventInstructionFiles(input.ws);
    if (files.length === 0) {
        return {
            ok: false,
            code: 'EVENT_INDEX_SOURCE_UNAVAILABLE',
            message: '工作区没有已索引的 EMEVD 文件；事件参数索引为空，不能据此判断任何实体。'
        };
    }
    const index = await getEventInstructionIndex({
        workspaceId: input.workspaceId,
        files,
        registry: registry.registry,
        readDocument: (file) => readFullEmevdDocumentViaBridge({
            filePath: file.absolutePath,
            allowedRoots: input.edit.allowedRoots(),
            resourceUri: file.sourceUri,
            registry: registry.registry,
            timeoutMs: 120_000,
            attachIdentity: false,
            // 索引只读；Bridge 的缓存以内容哈希为键，命中即复用，不冒充“刚读盘”。
            cachePolicy: 'default',
            ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
            ...(input.signal ? { signal: input.signal } : {})
        }),
        ...(input.signal ? { signal: input.signal } : {})
    });
    return { ok: true, index };
}
//# sourceMappingURL=eventArgumentIndexService.js.map