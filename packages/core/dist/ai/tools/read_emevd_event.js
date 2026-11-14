import { asRecord, asString, fail, nativePathFromFileToken, ok, requireEditSession, resolveReadEmevdEvent } from '../toolRegistrySupport.js';
import { parseReadOrigin, readOriginSource, resolveReadOriginFile } from '../readOrigin.js';
/** read_emevd_event: one domain tool declaration, schema and handler. */
export function createReadEmevdEventTool() {
    return {
        name: 'read_emevd_event',
        description: 'Read exactly one EMEVD event through the native core readEmevdEvent authority. '
            + 'origin selects the layer: "workspace" (default) reads the opened workspace file, "base" reads the same relative path under the game base root (--base), i.e. the vanilla file. '
            + 'Use origin:"base" to answer "is this how the game ships, or did the mod change it?"; every result carries source:{root,path} naming the layer that answered, and a base view is read-only (it never mints a write receipt). '
            + 'A complete format=darkscript read from instructionOffset=0 through the native total returns data.record.projection=complete_native_dsl: '
            + 'the full DarkScript, native evidence/provenance and native identity are retained while auxiliary machine DTO is omitted; this is the only event read view that can mint a write receipt. '
            + 'Use format=json or instructionOffset/instructionLimit paging when machine instructions are needed, but JSON, tail, partial, or incomplete windows remain inspect-only and cannot authorize event writes. '
            + 'If file does not directly match an indexed sourceUri/sourcePath/relativePath/absolutePath, the native read may still succeed as inspect-only and cannot mint a write receipt; use search_events to obtain the complete sourceUri and reread. '
            + 'It never uses RAG or an index projection as a native-read substitute. format defaults to darkscript. '
            + 'The write receipt lives only in the session store that produced it (one CLI `session` process, one Agent run, one desktop session), keyed by principal+workspace. A read in another process or another `session` invocation cannot authorize a write, even on the same workspace path; within one session it stays valid across any number of calls until the source is written, changed externally, or the session closes. Do the read and the write in one `session` (or one Agent run).',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            eventId: 'safe-integer',
            format: 'enum:darkscript|json?',
            instructionOffset: 'safe-integer?',
            instructionLimit: 'safe-integer?',
            origin: 'enum:workspace|base?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            const file = asString(value.file).trim();
            const eventId = typeof value.eventId === 'number' && Number.isSafeInteger(value.eventId)
                ? value.eventId
                : undefined;
            if (!file || eventId === undefined) {
                return fail('INVALID_INPUT', 'read_emevd_event 需要 file 与安全整数 eventId。');
            }
            if (!context.session)
                return fail('WORKSPACE_REQUIRED', '这次原生 EMEVD 事件读取需要先打开 Mod 工作区。');
            const originParse = parseReadOrigin(value.origin);
            if (!originParse.ok)
                return fail(originParse.code, originParse.message);
            const resolvedFile = await resolveReadOriginFile(context, file, 'event', originParse.origin);
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const nativeFile = context.hostResolvedEmevdEventTarget?.sourcePath
                ?? nativePathFromFileToken(resolvedFile.path);
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const reader = resolveReadEmevdEvent();
            if (!reader) {
                return fail('EMEVD_EVENT_READ_UNAVAILABLE', '当前核心尚未提供 readEmevdEvent 原生事件读取门面，已拒绝用索引或 RAG 结果冒充 native read。', { authority: 'core.readEmevdEvent', file, eventId });
            }
            const format = value.format === undefined ? undefined : value.format;
            const instructionOffset = value.instructionOffset === undefined
                ? undefined
                : typeof value.instructionOffset === 'number' && Number.isSafeInteger(value.instructionOffset)
                    ? value.instructionOffset
                    : undefined;
            const instructionLimit = value.instructionLimit === undefined
                ? undefined
                : typeof value.instructionLimit === 'number' && Number.isSafeInteger(value.instructionLimit)
                    ? value.instructionLimit
                    : undefined;
            if (value.instructionOffset !== undefined && instructionOffset === undefined) {
                return fail('INVALID_INPUT', 'instructionOffset 必须是安全整数。');
            }
            if (value.instructionLimit !== undefined && instructionLimit === undefined) {
                return fail('INVALID_INPUT', 'instructionLimit 必须是安全整数。');
            }
            const result = await reader({
                edit: edit.session,
                file: nativeFile,
                eventId,
                ...(format ? { format } : {}),
                ...(instructionOffset !== undefined ? { instructionOffset } : {}),
                ...(instructionLimit !== undefined ? { instructionLimit } : {}),
                ...(context.signal ? { signal: context.signal } : {})
            });
            if (!result.ok) {
                const error = asRecord(result.error);
                return fail(asString(error.code, 'EMEVD_EVENT_READ_FAILED'), asString(error.message, 'EMEVD 事件读取失败。'), result.diagnostics);
            }
            const resultRecord = result;
            // Bind the model-facing/native receipt to the workspace-indexed URI.
            // The facade's URI is derived from its physical path and may otherwise
            // contain a sanitized-but-user-specific path rather than the canonical
            // resource identity used by search_events.
            const canonicalSourceUri = context.hostResolvedEmevdEventTarget?.sourceUri
                ?? resolvedFile.sourceUri;
            const provenance = {
                ...(asRecord(resultRecord.provenance)),
                authority: 'native-emevd-event',
                sourceUri: canonicalSourceUri,
                ...(typeof resultRecord.sourceHash === 'string' ? { sourceHash: resultRecord.sourceHash } : {}),
                ...(typeof resultRecord.sourceRevision === 'number' || typeof resultRecord.sourceRevision === 'string'
                    ? { sourceRevision: resultRecord.sourceRevision }
                    : {}),
                ...(typeof resultRecord.registryFingerprint === 'string'
                    ? { registryFingerprint: resultRecord.registryFingerprint }
                    : {})
            };
            // Hand the caller the canonical event URI so explain_event / reference lookups can be chained
            // without guessing a scheme (event://<mapId>/<eventId>).
            const mapStem = /([^/\\]+)\.emevd/i.exec(canonicalSourceUri)?.[1];
            const eventUri = typeof resultRecord.eventId === 'number' && mapStem
                ? `event://${mapStem}/${resultRecord.eventId}`
                : undefined;
            return ok({
                ...resultRecord,
                sourceUri: canonicalSourceUri,
                source: readOriginSource(resolvedFile.origin, resolvedFile.relativePath),
                ...(eventUri ? { eventUri } : {}),
                provenance,
                ...(eventUri
                    ? { nextActions: [{ tool: 'explain_event', args: { uri: eventUri }, reason: '按事件 URI 构建证据化解释输入。' }] }
                    : {})
            });
        }
    };
}
//# sourceMappingURL=read_emevd_event.js.map