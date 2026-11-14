import { MSB_TRANSFORM_FIELDS, asMsbTransformEdits, asRecord, asString, fail, finalizeCommittedToolResult, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { executeMapTransaction, loadMapDocument } from '../../editing/mapService.js';
import { parseMapAddress } from '@soulforge/shared';
/** mutate_msb_part_transform: one domain tool declaration, schema and handler. */
export function createMutateMsbPartTransformTool() {
    return {
        name: 'mutate_msb_part_transform',
        description: 'Set MSB part position/rotation/scale through Patch Engine (write-msb '
            + 'msb_set_part_position / msb_set_part_transform). file accepts the concrete .msb/.msb.dcx '
            + 'path or a unique sourceUri from search_map_entities; a logical map id alone is resolved '
            + 'only when the workspace index has one match. edits: [{ address: m11_01_00_00#c1050_0000, '
            + 'nativeOffset, posX?, posY?, posZ?, rotX?, rotY?, rotZ?, scaleX?, scaleY?, scaleZ? }]. '
            + 'nativeOffset is the write identity because MSB allows duplicate part names; address may '
            + 'also carry it explicitly (m11_01_00_00#c1010_0071@0x4f50c0) and must agree with the field. '
            + 'The name in address is checked against the entity at that offset, so a name/offset '
            + 'mismatch fails instead of writing the wrong duplicate.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: { file: 'string', edits: 'array' },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.domain && value.domain !== 'map') {
                return fail('DOMAIN_CROSSOVER_REJECTED', `MSB 变换工具不能接收 ${value.domain} 领域的请求。`);
            }
            if (value.fieldKind && value.fieldKind !== 'native_value') {
                return fail('FIELD_KIND_NON_NATIVE', `${value.fieldKind} 不是原生字段类型，不能写入 MSB。`);
            }
            const file = asString(value.file);
            const edits = asMsbTransformEdits(value.edits);
            if (!file)
                return fail('INVALID_INPUT', 'mutate_msb_part_transform 需要 file。');
            if (!edits.ok)
                return fail(edits.code, edits.message);
            if (edits.edits.length === 0)
                return fail('INVALID_INPUT', 'mutate_msb_part_transform 需要非空 edits 数组。');
            for (const item of edits.edits) {
                if (/^[a-z0-9_]+#A\d/i.test(item.address)) {
                    return fail('DOMAIN_CROSSOVER_REJECTED', `MSB 变换工具不能接收 TAE 动作地址：${item.address}`);
                }
                const record = item;
                if (record.valueKind === 'display_label' || record.valueKind === 'external_metadata') {
                    return fail('FIELD_KIND_NON_NATIVE', 'display_label / external_metadata 不能作为 MSB 原生坐标写入：请传 posX/posY/posZ 等原生字段。');
                }
            }
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const resolvedFile = resolveIndexedResourceFile(context, file, 'map');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const loaded = await loadMapDocument(edit.session, resolvedFile.path);
            if (!loaded.ok)
                return fail(loaded.error.code, loaded.error.message);
            const canonicalEdits = [];
            for (const item of edits.edits) {
                if (item.nativeOffset === undefined) {
                    return fail('MSB_NATIVE_OFFSET_REQUIRED', `${item.address} 写入必须携带 nativeOffset；地址/名称仅作诊断，不能作为唯一目标。`);
                }
                const parsed = parseMapAddress(item.address);
                if (!parsed?.name)
                    return fail('MSB_ADDRESS_INVALID', `无法解析 MSB part 地址：${item.address}`);
                // An `@0x<offset>` suffix and the nativeOffset field are the same identity spelled
                // twice. Two different values mean the caller is unsure which entity it means.
                if (parsed.nativeOffset !== undefined && parsed.nativeOffset !== item.nativeOffset) {
                    return fail('MSB_NATIVE_IDENTITY_MISMATCH', `地址里的偏移与 nativeOffset 不一致：address=${item.address} addressOffset=${parsed.nativeOffset} nativeOffset=${item.nativeOffset}；`
                        + 'MSB 允许重名 part，请确认要写的是哪一条（address 用带 @0x 偏移的形式）。', [{ address: item.address, addressOffset: parsed.nativeOffset, nativeOffset: item.nativeOffset }]);
                }
                const resolved = loaded.sceneGraph.resolveNativeIdentity({
                    family: 'part',
                    nativeOffset: item.nativeOffset,
                    expectedName: parsed.name
                });
                if (!resolved.ok)
                    return fail(resolved.code, `MSB native identity 未唯一解析：${item.address}@${item.nativeOffset}`
                        + (resolved.candidates.length === 0
                            ? '（该 nativeOffset 在本图不存在）'
                            : `（候选：${resolved.candidates.map((candidate) => `${candidate.address} name=${candidate.name} nativeOffset=${candidate.nativeOffset}`).join('、')}）`), resolved.candidates.map((candidate) => ({
                        address: candidate.address,
                        name: candidate.name,
                        nativeOffset: candidate.nativeOffset
                    })));
                if (resolved.entity.kind !== 'part')
                    return fail('MSB_ENTITY_KIND_INVALID', `MSB native identity 不是 Part：${item.address}@${item.nativeOffset}`);
                if (!MSB_TRANSFORM_FIELDS.some((field) => item[field] !== undefined)) {
                    return fail('MSB_EDIT_EMPTY', `${item.address} 没有任何要写入的变换字段。`);
                }
                canonicalEdits.push({ item, target: resolved.entity.stableKey, part: resolved.entity });
            }
            const transaction = {
                id: `tx-agent-msb-${Date.now()}`,
                mapId: loaded.doc.mapId,
                baseRevision: loaded.doc.revision,
                description: `Agent MSB Part 变换 (${canonicalEdits.length} 项)`,
                author: 'agent',
                operations: canonicalEdits.map(({ item, target, part }) => ({
                    kind: 'set_transform',
                    target,
                    ...(item.posX !== undefined || item.posY !== undefined || item.posZ !== undefined
                        ? { position: [
                                item.posX ?? part.transform.position[0],
                                item.posY ?? part.transform.position[1],
                                item.posZ ?? part.transform.position[2]
                            ] }
                        : {}),
                    ...(item.rotX !== undefined || item.rotY !== undefined || item.rotZ !== undefined
                        ? { rotation: [
                                item.rotX ?? part.transform.rotation[0],
                                item.rotY ?? part.transform.rotation[1],
                                item.rotZ ?? part.transform.rotation[2]
                            ] }
                        : {}),
                    ...(item.scaleX !== undefined || item.scaleY !== undefined || item.scaleZ !== undefined
                        ? { scale: [
                                item.scaleX ?? part.transform.scale[0],
                                item.scaleY ?? part.transform.scale[1],
                                item.scaleZ ?? part.transform.scale[2]
                            ] }
                        : {})
                })),
                timestamp: Date.now()
            };
            const result = await executeMapTransaction(edit.session, resolvedFile.path, transaction);
            if (!result.ok)
                return fail(result.error?.code ?? 'MSB_TRANSACTION_FAILED', result.error?.message ?? 'MSB 地图事务失败。', result.error?.details);
            return finalizeCommittedToolResult({
                data: { ...result, status: result.verification ?? 'completed' },
                changedSources: [resolvedFile.path],
                context
            });
        }
    };
}
//# sourceMappingURL=mutate_msb_part_transform.js.map