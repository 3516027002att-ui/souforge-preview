import { asRecord, asString, fail, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { isMapPartSemanticKind, MAP_PART_SEMANTIC_KINDS, MAP_STRUCTURAL_KINDS, projectMapEntityKind, queryMapEntities } from '../../editing/mapService.js';
/** query_map_objects: one domain tool declaration, schema and handler. */
export function createQueryMapObjectsTool() {
    return {
        name: 'query_map_objects',
        description: 'Read and query native semantic map objects (Parts, Regions, Models, Events) by '
            + 'modelName, entityId, kind, or name. file accepts a concrete .msb/.msb.dcx path, a '
            + 'sourceUri returned by search_map_entities, or a unique logical map id. Results include '
            + 'sourceUri/sourceHash and are bounded; use returned stable IDs for follow-up inspection. '
            + 'kind accepts either vocabulary: the structural family (model/part/region/event/route) or '
            + 'the native part kind (character/object/mapPiece/collision/asset). Each returned object '
            + 'carries kind (semantic, e.g. character) and family (structural, e.g. part), plus a unique '
            + 'address: duplicated part names carry their native offset (m11_01_00_00#c1010_0071@0x4f50c0), '
            + 'so every row address can be fed back to inspect_map_object / read_msb_parts as-is.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            modelName: 'string?',
            entityId: 'number?',
            kind: 'string?',
            nameContains: 'string?',
            regionName: 'string?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            if (!file)
                return fail('INVALID_INPUT', 'query_map_objects 需要 file。');
            const resolvedFile = resolveIndexedResourceFile(context, file, 'map');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            // Two names describe this object: the scene family (part) and the native part kind
            // (character). Accepting only the former made kind="character" fail on an object whose
            // own search hit says kind=character; an unknown word still names both vocabularies.
            let kind;
            let partKind;
            if (value.kind !== undefined && String(value.kind).trim() !== '') {
                const rawKind = asString(value.kind).trim();
                const normalized = rawKind.toLowerCase().replace(/s$/u, '');
                if (MAP_STRUCTURAL_KINDS.includes(normalized)) {
                    kind = normalized;
                }
                else if (isMapPartSemanticKind(normalized)) {
                    // 与 kind=part 同一候选集，再按原生 part 类型收窄。
                    const canonical = normalized === 'mappiece' ? 'mapPiece' : normalized;
                    kind = 'part';
                    partKind = canonical;
                }
                else {
                    return fail('MAP_KIND_INVALID', `query_map_objects 的 kind 接受结构族 ${MAP_STRUCTURAL_KINDS.join(' / ')} `
                        + `或原生 part 类型 ${MAP_PART_SEMANTIC_KINDS.join(' / ')}，收到「${rawKind}」。`
                        + '两者是同一对象的两套词表：part 是结构族，character/object/… 是原生 part 类型。留空返回全部实体（会分页）。');
                }
            }
            const result = await queryMapEntities(edit.session, resolvedFile.path, {
                ...(value.modelName ? { modelName: asString(value.modelName) } : {}),
                ...(typeof value.entityId === 'number' ? { entityId: Number(value.entityId) } : {}),
                ...(kind === undefined ? {} : { kind }),
                ...(value.nameContains ? { nameContains: asString(value.nameContains) } : {}),
                ...(value.regionName ? { regionName: asString(value.regionName) } : {})
            });
            if (!result.ok)
                return fail(result.error?.code ?? 'QUERY_FAILED', result.error?.message ?? '查询地图实体失败', result.error?.candidates);
            const matched = (partKind === undefined
                ? result.matchedEntities
                : result.matchedEntities.filter((entity) => entity.kind === 'part' && projectMapEntityKind(entity).kind === partKind))
                .map(projectMapEntityKind);
            const filtered = ['modelName', 'entityId', 'kind', 'nameContains', 'regionName']
                .some((key) => value[key] !== undefined && String(value[key]).trim() !== '');
            // A query can return thousands of rows (kind="part" is ~4k on a full map, an unfiltered call
            // is every entity); the delivery budget then elides the body down to identity fields. Hand
            // back a bounded first page and say how many exist, instead of a payload nobody can see.
            if (matched.length <= 20)
                return ok({ ...result, matchedEntities: matched });
            return ok({
                ...result,
                matchedEntities: matched.slice(0, 20),
                bounded: true,
                matchedReturnedCount: 20,
                matchedTotalCount: matched.length,
                note: filtered
                    ? `过滤后仍有 ${matched.length} 个实体，本次只返回前 20 个。请加上 modelName / entityId / nameContains 收窄，或用 export_map_for_blender 分页导出。`
                    : `未提供过滤条件：该地图共 ${result.totalEntities} 个实体，本次只返回前 20 个。`
                        + '请用 modelName / entityId / kind / nameContains 过滤；要完整场景用 export_map_for_blender 分页导出。',
                nextActions: [{ tool: 'export_map_for_blender', args: { file }, reason: '按页导出完整场景描述。' }]
            });
        }
    };
}
//# sourceMappingURL=query_map_objects.js.map