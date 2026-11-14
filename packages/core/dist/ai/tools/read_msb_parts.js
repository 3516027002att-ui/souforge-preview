import { asRecord, asString, asStringList, fail, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readMsbParts } from '../../editing/msbEdit.js';
import { mapPartKindFromTypeId } from '../../editing/mapService.js';
import { createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
const MSB_PARTS_CURSOR_SESSION = 'msb-parts-v1';
/** read_msb_parts: one domain tool declaration, schema and handler. */
export function createReadMsbPartsTool() {
    return {
        name: 'read_msb_parts',
        description: 'Read native MSB Parts by exact map address (for example '
            + 'm10_00_00_00#c1150_0006). file accepts a concrete .msb/.msb.dcx path, a sourceUri '
            + 'returned by search_map_entities, or a unique logical map id. The result includes '
            + 'nativeOffset, model/transform data, sourceUri, and sourceHash; use nativeOffset plus '
            + 'the expected name for later writes. MSB allows duplicate part names, so address is '
            + 'unique per part: a duplicated name carries its native offset (m11_01_00_00#c1010_0071@0x4f50c0) '
            + 'while a unique name keeps m11_01_00_00#c1050_0000. Requesting the bare name of a duplicated '
            + 'part fails with MSB_ADDRESS_AMBIGUOUS and lists the candidate addresses; pass one of those '
            + '(or include @0x<offset>) to read exactly one part.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { file: 'string', addresses: 'array?', cursor: 'string?', offset: 'safe-integer?', limit: 'safe-integer?' },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            if (!file)
                return fail('INVALID_INPUT', 'read_msb_parts 需要 file。');
            const resolvedFile = resolveIndexedResourceFile(context, file, 'map');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const addresses = value.addresses === undefined ? [] : asStringList(value.addresses);
            if (value.addresses !== undefined && addresses.length === 0) {
                return fail('INVALID_INPUT', 'read_msb_parts 的 addresses 必须是非空字符串数组。');
            }
            const result = await readMsbParts({
                edit: edit.session,
                file: resolvedFile.path,
                ...(addresses.length > 0 ? { addresses } : {})
            });
            if (!result.ok)
                // Ambiguous-address answers carry the candidate list in error.details; diagnostics is
                // the fallback for failures that have none.
                return fail(result.error.code, result.error.message, result.error.details ?? result.diagnostics);
            // The schema advertised `cursor` but nothing read it, and an addressless read returned a
            // six-part preview of 2772 parts with no way to reach the rest. Page here with the shared
            // opaque cursor, binding the continuation to the source hash of this read.
            const all = result.parts ?? [];
            const requestedLimit = typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit > 0
                ? Math.min(50, value.limit)
                : 50;
            let offset = 0;
            if (typeof value.cursor === 'string' && value.cursor.trim() !== '') {
                const payload = parseOpaqueCursor(value.cursor);
                if (payload.sessionId !== MSB_PARTS_CURSOR_SESSION || payload.domain !== 'map') {
                    return fail('INVALID_READ_CURSOR', 'MSB parts 游标不属于本次读取：请重新读取第一页，再跟随返回的 nextCursor。');
                }
                if (payload.scope !== String(result.sourceHash ?? '')) {
                    return fail('STALE_READ_CURSOR', '地图已在分页期间改变，请重新读取。');
                }
                offset = payload.offset;
            }
            else if (typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0) {
                offset = value.offset;
            }
            if (offset > all.length)
                return fail('INVALID_READ_CURSOR', 'offset 超出 parts 数量：请用返回的 nextCursor 续读，或把 offset 调到返回的总数以内。');
            const page = all.slice(offset, offset + requestedLimit)
                // Same object, same words as search_map_entities/query_map_objects: kind is the native
                // part type, family the structural one. Only family existed here.
                .map((part) => ({ ...part, kind: mapPartKindFromTypeId(part.typeId), family: part.family }));
            const nextOffset = offset + page.length;
            const more = nextOffset < all.length;
            return ok({
                ...result,
                parts: page,
                partsReturnedCount: page.length,
                partsTotalCount: all.length,
                partsOffset: offset,
                // export_map_for_blender publishes offset/limit/hasMore/truncated; match it so a caller
                // reading either paginated map result finds the same field names.
                offset,
                limit: requestedLimit,
                returned: page.length,
                hasMore: more,
                truncated: more || offset > 0,
                partsTruncated: more,
                ...(more ? {
                    nextCursor: createOpaqueCursor({
                        sessionId: MSB_PARTS_CURSOR_SESSION,
                        domain: 'map',
                        scope: String(result.sourceHash ?? ''),
                        sourceHash: String(result.sourceHash ?? ''),
                        offset: nextOffset
                    })
                } : {})
            });
        }
    };
}
//# sourceMappingURL=read_msb_parts.js.map