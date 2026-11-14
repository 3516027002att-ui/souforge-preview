import { asRecord, asString, fail, nativePathFromFileToken, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import * as emevdEdit from '../../editing/emevdEdit.js';
import { basename } from 'node:path';
/** read_emevd_outline: one domain tool declaration, schema and handler. */
export function createReadEmevdOutlineTool() {
    return {
        name: 'read_emevd_outline',
        description: 'Read event IDs and instruction counts from an overlay EMEVD file. '
            + 'Pass offset (default 0) and limit (default 8, maximum 256) to page through all events. '
            + 'Every page states hasMore at the record top level, exactly consistent with nextOffset: hasMore=true iff nextOffset is present, so following hasMore/nextOffset reaches every event. '
            + 'The outline is read-only metadata, not a complete DarkScript write receipt. '
            + 'It does return sourceHash/outerFileHash/sourceRevision for the file. Each page records the slice it delivered; pages of the same source version accumulate, so paging to hasMore=false is equivalent to one complete read and authorizes apply_emevd_dsl createIfMissing=true. '
            + 'A partial read authorizes nothing: createIfMissing requires the union of delivered pages to cover every event id, and a gap is refused with NATIVE_READ_COVERAGE_INCOMPLETE naming the missing index ranges (and page numbers when the page size is uniform). '
            + 'The receipt lives only in the session that produced it: the same CLI `session` process / the same Agent run / the same desktop session. It is not stored in a session file or passed by session id, so reading in one process and writing in another `session` or `call` invocation cannot authorize a write even when the workspace path is identical. Within one session it survives any number of tool calls until the source is written, changed externally, or the session closes. '
            + 'Does not parse a second native format; uses Bridge read-emevd-document.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { file: 'string', offset: 'safe-integer?', limit: 'safe-integer?' },
        run: async (input, context) => {
            const value = asRecord(input);
            const offset = value.offset ?? 0;
            const limit = value.limit ?? 8;
            if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
                || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 256) {
                return fail('INVALID_INPUT', 'read_emevd_outline 的 offset 必须是非负安全整数，limit 必须是 1 到 256 的安全整数。');
            }
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const file = asString(value.file);
            if (!file)
                return fail('INVALID_INPUT', 'read_emevd_outline 需要 file。');
            const resolvedFile = resolveIndexedResourceFile(context, file, 'event');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const result = await emevdEdit.readEmevdOutline({
                edit: edit.session,
                file: nativePathFromFileToken(resolvedFile.path)
            });
            if (!result.ok)
                return fail(result.error?.code ?? 'EMEVD_READ_FAILED', result.error?.message ?? '读取失败。');
            if (context.workspaceIndex && result.events) {
                const indexedFile = context.workspaceIndex.getFiles().find((candidate) => candidate.absolutePath === result.filePath);
                const sourceUri = indexedFile?.sourceUri ?? result.filePath ?? file;
                const sourceHash = result.sourceHash;
                const sourceRevision = indexedFile?.mtimeMs;
                const mapId = basename(sourceUri).replace(/\.emevd(?:\.dcx)?$/i, '');
                context.workspaceIndex.upsertEventExport({
                    mapId,
                    ...(sourceHash ? { sourceHash } : {}),
                    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                    events: result.events.map((event) => ({
                        uri: `${sourceUri}#event/${event.eventId}`,
                        sourceUri,
                        mapId,
                        eventId: event.eventId,
                        ...(sourceHash ? { sourceHash } : {}),
                        ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                        instructions: [],
                        raw: {
                            authority: 'native-read-outline',
                            instructionCount: event.instructionCount,
                            restBehavior: event.restBehavior,
                            semanticArgsDecoded: false
                        }
                    }))
                });
                context.workspaceIndex.rebuildReferences();
                await context.onSemanticEvidenceUpdated?.([sourceUri]);
            }
            // The index above always consumes the complete native outline. Only the
            // model-facing result is paged; no event disappears from future windows.
            const allEvents = result.events ?? [];
            const events = allEvents.slice(offset, offset + limit);
            const truncated = offset + events.length < allEvents.length;
            return ok({
                ...result,
                sourceUri: resolvedFile.sourceUri,
                canonical: resolvedFile.canonical === true,
                events,
                total: allEvents.length,
                totalCount: allEvents.length,
                offset,
                limit,
                returned: events.length,
                returnedCount: events.length,
                truncated,
                // The paging flag lived only as `truncated`/`nextOffset`; a caller that
                // followed the documented `hasMore` found nothing at the record level and
                // stopped after the first page. Publish it here, derived from the same
                // comparison that produces nextOffset, so the two can never disagree.
                hasMore: truncated,
                remainingCount: Math.max(0, allEvents.length - offset - events.length),
                darkScriptComplete: false,
                ...(truncated ? {
                    nextOffset: offset + events.length,
                    continuationParams: { file, offset: offset + events.length, limit },
                    nextActions: [{ tool: 'read_emevd_outline',
                            args: { file, offset: offset + events.length, limit },
                            reason: '继续读取后续事件页；hasMore=false 时全部事件已取完。' }]
                } : {})
            });
        }
    };
}
//# sourceMappingURL=read_emevd_outline.js.map