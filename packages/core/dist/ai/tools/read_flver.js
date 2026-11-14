import { isFlverDocument, projectFlverDocumentPages } from '@soulforge/shared';
import { asFlverSection, asNumber, asRecord, asString, fail, ok, paginateToolRows, requireEditSession, resolveWorkspaceFileToken } from '../toolRegistrySupport.js';
import { runBridge } from '../../bridge/runBridge.js';
import { modelFacingEntryName } from '../agentToolBridge.js';
const DEFAULT_PAGE_ROWS = 256;
const MAX_PAGE_ROWS = 4096;
/**
 * Rows per native table the Bridge envelope should carry. The Bridge default is
 * 10 (a compact probe); 1024 covers every real Sekiro model measured here
 * (c1020: 36 meshes / 357 texture slots / 346 bones) while keeping the frame
 * well under the Bridge frame limit. Anything larger comes back with
 * `truncated.<table> = true` and the full count in `counts`, never silently cut.
 */
const NATIVE_SAMPLE_LIMIT = 1024;
const SECTIONS = ['meshes', 'materials', 'texture-slots', 'bones'];
/**
 * read_flver: one FLVER model document (bounds, meshes, materials, texture
 * slots, bones) projected from the native Bridge document (`read-flver-document`).
 *
 * The same tool covers the three input shapes the Bridge now accepts:
 * loose `.flver`, a DCX-wrapped loose FLVER, and a chrbnd/objbnd/mapbnd
 * container. A container with several `.flver` entries (objbnd/mapbnd ship a
 * body model plus a `_S` variant) cannot be guessed: the Bridge fails with
 * FLVER_CONTAINER_ENTRY_AMBIGUOUS and lists every candidate, and the caller
 * retries with `entryIndex` (or `entryName`). This tool never picks the first
 * child itself.
 */
export function createReadFlverTool() {
    return {
        name: 'read_flver',
        description: 'Read one Sekiro FLVER model document: a loose .flver / .flver.dcx, or a .chrbnd.dcx / .objbnd.dcx / .mapbnd.dcx container child. '
            + 'Returns native identity and bounds, then one paged section: meshes (index, materialIndex, vertexCount, vertexStride, bufferLayoutIndex, faceSetCount, boneCount, indexFormat), '
            + 'materials (index, name, mtdPath, textureCount, firstTextureIndex, gxIndex), texture-slots (index, type, path, materialIndex, tilingScale, tilingType) or bones (name, parentIndex, nextSiblingIndex). '
            + 'Header counts (meshCount/materialCount/textureCount/boneCount/faceCount) describe the whole model regardless of the page. '
            + 'When the input is a container, `container` states which physical child was read (format, entryCount, flverEntryCount, entryIndex, entryId, entryName, contentHash); it is absent for a loose FLVER, so "no container" is never confused with "entry 0". '
            + 'A container with more than one .flver entry fails with FLVER_CONTAINER_ENTRY_AMBIGUOUS and lists every candidate (entryIndex + entryName); retry with entryIndex. '
            + 'Answers: how many meshes/materials/texture slots/bones a model has, which material a mesh uses, and what texture slots a material binds. '
            + 'Read-only metadata: it does NOT return vertex/index buffers (no geometry payload), does NOT decode texture pixels, does NOT read MTD shader semantics, and does NOT write. '
            + 'KRAK-compressed containers need the original game root mounted for the Oodle runtime, otherwise the Bridge returns DCX_COMPRESSION_UNAVAILABLE.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            entryIndex: 'safe-integer?',
            entryName: 'string?',
            section: 'enum:meshes|materials|texture-slots|bones?',
            offset: 'safe-integer?',
            limit: 'safe-integer?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file).trim();
            if (!file)
                return fail('INVALID_INPUT', 'read_flver 需要 file。');
            const hasEntryIndex = value.entryIndex !== undefined && value.entryIndex !== null;
            if (hasEntryIndex && (typeof value.entryIndex !== 'number' || !Number.isSafeInteger(value.entryIndex) || value.entryIndex < 0))
                return fail('INVALID_INPUT', 'read_flver 的 entryIndex 必须是非负安全整数（容器候选列表里的 entryIndex）。');
            const entryName = value.entryName === undefined || value.entryName === null ? undefined : asString(value.entryName).trim();
            if (entryName !== undefined && entryName === '')
                return fail('INVALID_INPUT', 'read_flver 的 entryName 不能是空字符串；留空表示不按名字选择。');
            const requestedSection = value.section === undefined || value.section === null
                ? 'meshes'
                : asFlverSection(value.section);
            if (requestedSection === '__unaccepted__')
                return fail('INVALID_INPUT', `read_flver 的 section 取值应为 ${SECTIONS.join(' | ')} 之一。`);
            const section = requestedSection;
            const offset = Math.trunc(asNumber(value.offset, 0));
            const limit = Math.trunc(asNumber(value.limit, DEFAULT_PAGE_ROWS));
            if (!Number.isSafeInteger(offset) || offset < 0)
                return fail('INVALID_INPUT', 'read_flver 的 offset 必须是非负安全整数。');
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_ROWS)
                return fail('INVALID_INPUT', `read_flver 的 limit 必须是 1..${MAX_PAGE_ROWS} 的安全整数。`);
            const resolved = resolveWorkspaceFileToken(context, file, { ambiguousCode: 'FLVER_SOURCE_AMBIGUOUS' });
            if (!resolved.ok)
                return fail(resolved.code, resolved.message, resolved.details);
            const result = await runBridge({
                command: 'read-flver-document',
                filePath: resolved.path,
                ...(resolved.sourceUri === undefined ? {} : { resourceUri: resolved.sourceUri }),
                allowedRoots: edit.session.allowedRoots(),
                ...(edit.session.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.session.oodleRuntimeRoot } : {}),
                commandOptions: {
                    sampleLimit: NATIVE_SAMPLE_LIMIT,
                    ...(hasEntryIndex ? { entryIndex: value.entryIndex } : {}),
                    ...(entryName === undefined ? {} : { entryName })
                },
                timeoutMs: 180_000
            });
            if (result.parseStatus === 'failed' || !result.data || !isFlverDocument(result.data)) {
                const diagnostic = result.diagnostics?.find((item) => item.severity === 'error') ?? result.diagnostics?.[0];
                return fail(diagnostic?.code ?? 'FLVER_READ_FAILED', diagnostic?.message ?? 'FLVER 读取失败。', projectFailureDetails(diagnostic?.details));
            }
            const document = result.data;
            const pages = projectFlverDocumentPages(document);
            const header = {
                format: document.format,
                version: document.version,
                internalVersion: document.internalVersion,
                sourceSize: document.sourceSize,
                sourceHash: document.sourceHash,
                authority: document.authority,
                ...(resolved.sourceUri === undefined ? {} : { sourceUri: resolved.sourceUri }),
                container: projectContainer(document.container),
                counts: {
                    meshCount: document.meshCount,
                    materialCount: document.materialCount,
                    textureCount: document.textureCount,
                    boneCount: document.boneCount,
                    faceCount: document.faceCount,
                    totalFaceCount: document.totalFaceCount,
                    vertexBufferCount: document.vertexBufferCount,
                    bufferLayoutCount: document.bufferLayoutCount
                },
                bounds: pages.bounds,
                truncated: {
                    meshes: pages.meshes.meshesTruncated || document.meshesTruncated,
                    materials: document.materialsTruncated,
                    textureSlots: pages.materialSlots.texturesTruncated,
                    bones: document.bonesTruncated
                },
                layoutWarnings: document.layoutWarnings,
                unparsedGaps: document.unparsedGaps
            };
            if (section === 'meshes') {
                const page = paginateToolRows(pages.meshes.meshes.map(projectMesh), offset, limit);
                return ok({ ...header, section, meshes: page.rows, ...pageWindow(page) });
            }
            if (section === 'materials') {
                const page = paginateToolRows((document.materials ?? []).map(projectMaterial), offset, limit);
                return ok({ ...header, section, materials: page.rows, ...pageWindow(page) });
            }
            if (section === 'texture-slots') {
                const page = paginateToolRows(pages.materialSlots.textures.map(projectTextureSlot), offset, limit);
                return ok({ ...header, section, textureSlots: page.rows, ...pageWindow(page) });
            }
            const page = paginateToolRows((document.bones ?? []).map(projectBone), offset, limit);
            return ok({ ...header, section, bones: page.rows, ...pageWindow(page) });
        }
    };
}
function projectContainer(container) {
    if (!container)
        return undefined;
    return {
        format: container.containerFormat,
        entryCount: container.entryCount,
        flverEntryCount: container.flverEntryCount,
        entryIndex: container.entryIndex,
        entryId: container.entryId,
        // BND4 entry 名常是作者构建机绝对路径；给模型的身份只要 basename。
        entryName: modelFacingEntryName(container.entryName),
        duplicateOrdinal: container.duplicateOrdinal,
        contentHash: container.contentHash
    };
}
function projectMesh(mesh) {
    return {
        index: mesh.index,
        dynamic: mesh.dynamic,
        materialIndex: mesh.materialIndex,
        defaultBoneIndex: mesh.defaultBoneIndex,
        vertexCount: mesh.vertexCount,
        vertexStride: mesh.vertexStride,
        bufferLayoutIndex: mesh.bufferLayoutIndex,
        faceSetCount: mesh.faceSetCount,
        boneCount: mesh.boneCount,
        indexFormat: mesh.indexFormat
    };
}
function projectMaterial(material) {
    return {
        index: material.index,
        name: material.name,
        mtdPath: modelFacingEntryName(material.mtdPath),
        textureCount: material.textureCount,
        firstTextureIndex: material.firstTextureIndex,
        gxIndex: material.gxIndex,
        gxOffset: material.gxOffset
    };
}
function projectTextureSlot(slot) {
    return {
        index: slot.index,
        type: slot.type,
        path: modelFacingEntryName(slot.path),
        materialIndex: slot.materialIndex,
        tilingScale: slot.tilingScale,
        tilingTypeU: slot.tilingTypeU,
        tilingTypeV: slot.tilingTypeV
    };
}
function projectBone(bone) {
    return { name: bone.name, parentIndex: bone.parentIndex, nextSiblingIndex: bone.nextSiblingIndex };
}
/**
 * The Bridge ambiguity failure carries every candidate's raw BND4 entry name,
 * which is usually the author's absolute build path. Project the names before
 * the list reaches the model; keep entryIndex/contentHash so the retry is exact.
 */
function projectFailureDetails(details) {
    const record = asRecord(details);
    const candidates = Array.isArray(record.candidates) ? record.candidates : undefined;
    const availableEntries = Array.isArray(record.availableEntries) ? record.availableEntries : undefined;
    if (!candidates && !availableEntries)
        return details;
    return {
        ...record,
        ...(candidates === undefined ? {} : { candidates: candidates.map(projectEntryIdentity) }),
        ...(availableEntries === undefined ? {} : { availableEntries: availableEntries.map(projectEntryIdentity) })
    };
}
function projectEntryIdentity(value) {
    const entry = asRecord(value);
    return {
        ...entry,
        ...(typeof entry.entryName === 'string' ? { entryName: modelFacingEntryName(entry.entryName) } : {})
    };
}
function pageWindow(page) {
    return {
        offset: page.offset,
        limit: page.limit,
        returnedCount: page.returnedCount,
        totalCount: page.totalCount,
        remainingCount: page.remainingCount,
        hasMore: page.hasMore,
        ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
        truncated: page.truncated,
        pagination: page.pagination
    };
}
//# sourceMappingURL=read_flver.js.map