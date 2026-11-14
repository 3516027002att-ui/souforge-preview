import { asNumber, asOptionalString, asRecord, asString, fail, ok, requireEditSession } from '../toolRegistrySupport.js';
import { loadMapDocument } from '../../editing/mapService.js';
import { createOpaqueCursor, exportMapSceneForBlender, parseOpaqueCursor } from '@soulforge/shared';
const SCENE_DOMAIN = 'map';
const SCENE_SCOPE = 'blender-scene';
const MIN_LIMIT = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** export_map_for_blender: one domain tool declaration, schema and handler. */
export function createExportMapForBlenderTool() {
    return {
        name: 'export_map_for_blender',
        description: 'Export canonical MapDocument to Blender-compatible JSON scene descriptor with stable identifiers and revisions. '
            + 'objects is paginated: limit defaults to 50 (max 200), and nextCursor continues the same scene. '
            + 'Every page repeats the header (schemaVersion, mapId, revision, exportedAt, objectTotal).',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { file: 'string', limit: 'number?', cursor: 'string?' },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            if (!file)
                return fail('INVALID_INPUT', 'export_map_for_blender 需要 file。');
            const loaded = await loadMapDocument(edit.session, file);
            if (!loaded.ok)
                return fail(loaded.error.code, loaded.error.message);
            const scene = exportMapSceneForBlender(loaded.doc);
            const objects = scene.objects ?? [];
            const requested = asNumber(value.limit, DEFAULT_LIMIT);
            const limit = Math.min(Math.max(Math.trunc(requested), MIN_LIMIT), MAX_LIMIT);
            const sessionId = context.workspaceIndex?.workspaceId ?? edit.session.session.meta.workspaceId;
            const identity = `${sessionId}|${scene.mapId}|${SCENE_SCOPE}`;
            const sourceHash = scene.revision ?? scene.exportedAt;
            let offset = 0;
            const cursor = asOptionalString(value.cursor);
            if (cursor !== undefined) {
                let payload;
                try {
                    payload = parseOpaqueCursor(cursor);
                }
                catch {
                    return fail('SCENE_CURSOR_INVALID', '场景游标无法解析，请从第一页重新导出。');
                }
                if (payload.domain !== SCENE_DOMAIN || payload.sessionId !== identity || payload.sourceHash !== sourceHash) {
                    return fail('SCENE_CURSOR_INVALID', '游标不属于当前地图版本，请重新导出。');
                }
                offset = payload.offset;
            }
            if (offset > objects.length)
                return fail('SCENE_CURSOR_INVALID', '游标超出场景对象范围，请重新导出。');
            const slice = objects.slice(offset, offset + limit);
            const end = offset + slice.length;
            // objectTotal counts the Blender scene (parts and regions), while query_map_objects counts every
            // entity kind on the map; publish the breakdown so the two totals do not look contradictory.
            const familyCounts = objects.reduce((acc, object) => {
                const family = String(object.family ?? 'unknown');
                acc[family] = (acc[family] ?? 0) + 1;
                return acc;
            }, {});
            const hasMore = end < objects.length;
            const nextCursor = hasMore
                ? createOpaqueCursor({ sessionId: identity, offset: end, sourceHash, domain: SCENE_DOMAIN, scope: SCENE_SCOPE })
                : undefined;
            return ok({
                schemaVersion: scene.schemaVersion,
                mapId: scene.mapId,
                revision: scene.revision,
                exportedAt: scene.exportedAt,
                objectTotal: objects.length,
                familyCounts,
                note: 'objectTotal 只统计进入 Blender 场景的 family（见 familyCounts）；query_map_objects 的 totalEntities 统计地图上的全部实体类型，两者数值不同是正常的。',
                objects: slice,
                total: objects.length,
                totalCount: objects.length,
                offset,
                limit,
                returned: slice.length,
                returnedCount: slice.length,
                truncated: hasMore || offset > 0,
                hasMore,
                ...(nextCursor ? { nextCursor } : {}),
                ...(nextCursor
                    ? { nextActions: [{ tool: 'export_map_for_blender', args: { file, cursor: nextCursor }, reason: '继续读取后续场景对象。' }] }
                    : {})
            });
        }
    };
}
//# sourceMappingURL=export_map_for_blender.js.map