import { asNumber, asRecord, asString, fail, ok, ragSearchFallback } from '../toolRegistrySupport.js';
/** search_map_entities: one domain tool declaration, schema and handler. */
export function createSearchMapEntitiesTool() {
    return {
        name: 'search_map_entities',
        description: 'Search parsed map entities and regions.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { query: 'string', limit: 'number?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const query = asString(value.query, '');
            const limit = asNumber(value.limit, 50);
            const nativeResults = ws.searchMapEntities(query, limit);
            // Hit and zero-hit used to return different types (array vs object), so a caller that mapped
            // over the result broke exactly when nothing matched. Both now return one object shape.
            // The index names a part by its native type (character/object/...); name the structural
            // family too, the same pair query_map_objects/inspect_map_object/read_msb_parts return.
            const mapped = nativeResults.map((result) => {
                const item = result.item;
                if (typeof item.mapId !== 'string' || typeof item.name !== 'string' || item.name === '') {
                    return { ...result, item: { ...result.item, family: 'kind' in item ? 'part' : 'region' } };
                }
                const family = 'kind' in item ? 'part' : 'region';
                return {
                    ...result,
                    item: {
                        ...result.item,
                        kind: 'kind' in item ? item.kind : family,
                        family,
                        // 重名 part/region 的地址必须带 @0x 偏移，否则按地址建索引的消费方
                        // 会把两个实体折叠成一条。地址生成复用索引/read_msb_parts 的同一函数。
                        address: ws.mapEntityAddress(result.item),
                        ...(typeof item.nativeOffset === 'number' ? { nativeOffset: item.nativeOffset } : {})
                    }
                };
            });
            if (mapped.length > 0)
                return ok({ items: mapped, totalCount: mapped.length });
            const fallback = await ragSearchFallback(context, query, ['map_entity', 'map_region'], limit, 'search_map_entities');
            // An unavailable corpus is not a clean miss: return the failure as it is instead of an empty
            // page the caller cannot tell apart from "the object is not in this map".
            if (!fallback.ok)
                return fallback;
            const fallbackData = fallback.data && typeof fallback.data === 'object'
                ? fallback.data
                : undefined;
            return ok({
                items: [],
                totalCount: 0,
                // A zero-hit search is not evidence that the object does not exist; saying so in a note
                // while the envelope claimed completeness=complete contradicted itself. Mark the result
                // partial so completeness and negativeConclusionAllowed agree with the note.
                negativeConclusionAllowed: false,
                ...(fallbackData === undefined ? {} : { fallback: fallbackData }),
                note: '本次没有命中地图对象：这只结束本次查询，不代表对象不存在——可以换名称、用 read_msb_parts 列出该地图的对象，或直接用 <mapId>#<name> 地址读取。'
            });
        }
    };
}
//# sourceMappingURL=search_map_entities.js.map