import { asRecord, asString, fail, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { inspectMapEntity, projectMapEntityKind } from '../../editing/mapService.js';
/** inspect_map_object: one domain tool declaration, schema and handler. */
export function createInspectMapObjectTool() {
    return {
        name: 'inspect_map_object',
        description: 'Inspect a specific native map object (Part, Region, Event) by name, ID, or '
            + 'stableKey, showing transform, model, and reverse references. identifier accepts '
            + '<mapId>#<name>, a bare entity name, or the map://<mapId>/<family>/<name> handle that '
            + 'search_map_entities returned. Pass the concrete map file '
            + 'or sourceUri returned by search_map_entities; logical map ids are accepted only when unique. '
            + 'Duplicate names are legal in MSB, so a name shared by two objects answers '
            + 'MAP_ENTITY_AMBIGUOUS with the candidate addresses (each carrying @0x<offset>); pass one '
            + 'of those addresses to inspect exactly one object. '
            + 'The entity carries kind (semantic: character/object/mapPiece/collision/asset, or '
            + 'region/event/model/route) and family (structural: part/region/event/model/route).',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { file: 'string', identifier: 'string' },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            const identifier = asString(value.identifier);
            if (!file || !identifier)
                return fail('INVALID_INPUT', 'inspect_map_object 需要 file 和 identifier。');
            const resolvedFile = resolveIndexedResourceFile(context, file, 'map');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const result = await inspectMapEntity(edit.session, resolvedFile.path, identifier);
            if (!result.ok)
                return fail(result.error?.code ?? 'INSPECT_FAILED', result.error?.message ?? '查看地图对象失败', result.error?.candidates);
            // mutate_msb_part_transform takes flat posX/rotX/scaleX fields while this read returns a
            // nested transform; expose both so a value copied from here can be pasted into a write.
            const flatTransform = (entity) => {
                const transform = entity?.transform;
                if (transform === undefined)
                    return entity;
                const position = transform.position ?? [];
                const rotation = transform.rotation ?? [];
                const scale = transform.scale ?? [];
                return {
                    ...entity,
                    ...(position.length === 3 ? { posX: position[0], posY: position[1], posZ: position[2] } : {}),
                    ...(rotation.length === 3 ? { rotX: rotation[0], rotY: rotation[1], rotZ: rotation[2] } : {}),
                    ...(scale.length === 3 ? { scaleX: scale[0], scaleY: scale[1], scaleZ: scale[2] } : {})
                };
            };
            const record = result;
            const projectedReferences = record.references && Array.isArray(record.references.partsUsingSameModel)
                ? { ...record.references, partsUsingSameModel: record.references.partsUsingSameModel.map(projectMapEntityKind) }
                : record.references;
            if (record.entity === undefined)
                return ok(record);
            return ok({
                ...record,
                ...(projectedReferences ? { references: projectedReferences } : {}),
                entity: flatTransform(projectMapEntityKind(record.entity))
            });
        }
    };
}
//# sourceMappingURL=inspect_map_object.js.map