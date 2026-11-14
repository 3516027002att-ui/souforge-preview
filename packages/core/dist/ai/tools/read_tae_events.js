import { containerFileFromActionUris } from '../taeContainerFile.js';
import { asNumber } from '.././toolRegistrySupport.js';
import { asRecord } from '.././toolRegistrySupport.js';
import { asString } from '.././toolRegistrySupport.js';
import { asStringList } from '.././toolRegistrySupport.js';
import { fail } from '.././toolRegistrySupport.js';
import { nativePathFromFileToken } from '.././toolRegistrySupport.js';
import { ok } from '.././toolRegistrySupport.js';
import { pathToFileURL } from 'node:url';
import { readTaeEvents } from '../../editing/taeEdit.js';
import { compactTaeEvent, TAE_COMPACT_PAGE_SIZE } from '../../editing/taeCompactEvent.js';
import { animationEntryIdOf, familyOfTaeEntry, hkxNameOf, TAE_ENTRY_ID_BASE } from '../../action/animFamily.js';
import { requireEditSession } from '.././toolRegistrySupport.js';
import { parseReadOrigin, readOriginSource, resolveReadOriginFile } from '../readOrigin.js';
/**
 * Derived naming fields, so no caller has to recompute the rules by hand.
 *
 * A TAE action knows its animId and its child (entryId / taeGroup / name) but never said what
 * family that child belongs to, nor which native hkx file the animation is. Those are pure
 * arithmetic (`action/animFamily.ts`), so they are attached here instead of being left as an
 * exercise: family, the entry-id decomposition, the animation entry id and the hkx name.
 * `hkxName` is marked `derived` because it is computed, not read from the file.
 */
function withDerivedNaming(record) {
    const identity = familyOfTaeEntry(record);
    if (identity === null)
        return record;
    const animationEntryId = typeof record.animId === 'number' ? animationEntryIdOf(identity.family, record.animId) : null;
    const hkxName = typeof record.animId === 'number' ? hkxNameOf(identity.family, record.animId) : null;
    return {
        ...record,
        // The Bridge's own taeGroup wins when present; the derived one only fills a gap.
        ...(record.taeGroup === undefined ? { taeGroup: identity.taeGroup } : {}),
        family: identity.family,
        taeEntryIdParts: { base: TAE_ENTRY_ID_BASE, family: identity.family, entryId: identity.taeEntryId },
        ...(animationEntryId === null ? {} : { animationEntryId }),
        ...(hkxName === null ? {} : { hkxName, hkxNameSource: 'derived' }),
        ...(identity.conflict === undefined ? {} : { familyConflict: identity.conflict })
    };
}
/** read_tae_events: one domain tool declaration, schema and handler. */
export function createReadTaeEventsTool() {
    return {
        name: 'read_tae_events',
        description: 'Read a bounded native TAE animation preview when addresses are omitted; follow cursor for the next preview page. '
            + 'origin selects the layer: "workspace" (default) reads the opened workspace container, "base" reads the same relative container under the game base root (--base), i.e. the vanilla animation data. Every result carries source:{root,path}; a base view is read-only and never updates the workspace catalog. '
            + 'A preview page is the cheap path: it lists actions with their addresses, event counts and first events (under a second on '
            + 'chr/c0000.anibnd.dcx once warm). '
            + 'Every preview page also carries a `preview` block so a count is never the only thing you get: eventTypeCounts is the type '
            + 'histogram of the whole page with names, firstEvents gives the leading events as eventIndex/eventTypeId/typeName/startTime/endTime '
            + '(plus their exact address), and actions lists every action of the page with its address, eventCount and the type ids it uses — '
            + 'so you can decide which action is worth the expensive per-action read without reading each one. '
            + 'Reading explicit addresses assembles the whole native document up to the byte budget — a large action yields about three events per page, so follow nextActions until hasMore is false — (about 100 s on c0000), so '
            + 'preview first to find the action, then read that one address once. '
            + 'Use an action-level cXXXX#AXXXX or section-qualified action URI to read every event of that action. Event addresses select exact events. Follow cursor with the same addresses, or an action nextRead, for remaining native events. '
            + 'file is optional when every address is a complete action:// URI (the URI already names the chr container and the TAE section); a legacy c1050#A0200 token, or addresses spanning several chr containers, still requires an explicit file. '
            + 'cursor 是进程内会话游标：只对产生它的那个 CLI/session 进程有效（宿主内存里的 native read proof 也是进程内），跨进程一定失败；换进程请重新读第一页，不要复用旧 cursor。 '
            + `projection "compact" (with addresses) returns compact events in fixed pages of ${TAE_COMPACT_PAGE_SIZE}, numbered like search_tae_events previews; its cursor stays compact. `
            + 'Compact omits field layout, padding that holds its asserted value, raw bytes of decoded events and info diagnostic details; omit projection for the full layout. '
            + 'Every decoded field carries both name and fieldName with the same value: fieldName is the selector mutate_tae_event_fields accepts, and name is the compatibility alias kept for older readers. '
            + 'Each listed action and TAE child also carries the derived naming fields, so the family rules never have to be recomputed by hand: '
            + 'family (EquipParamWeapon.wepmotionCategory), taeEntryIdParts {base:5000000, family, entryId}, animationEntryId '
            + '(1000000000 + family*1000000 + animId) and hkxName (a{family:03}_{animId:06}.hkt, marked hkxNameSource:"derived" because it is computed, not read). '
            + 'Use explain_animation to ask where an animId lives across families, or which family a weaponId belongs to. '
            + 'Read proofs are per TAE section: a same-container write only invalidates the section it wrote, so for insert_tae_events read the target action first and the template action/event second, then insert; that template proof survives inserts into another section. '
            + '预览页不构成写入授权：要修改某个事件，必须用 addresses 指定动作地址读一次，返回的物理身份与字段才可用于写入。',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { file: 'string?', addresses: 'array?', cursor: 'string?', offset: 'safe-integer?', pageSize: 'number?', projection: 'string?', expectedSourceHash: 'string?', expectedReaderSchemaRevision: 'safe-integer?', origin: 'enum:workspace|base?' },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            // A singular address or a limit here was silently ignored, and the browse then answered about
            // the first action instead of the one asked for — a wrong answer that looks like a success.
            if (value.address !== undefined || value.limit !== undefined) {
                return fail('INVALID_INPUT', 'read_tae_events 的入参是 addresses（数组）和 pageSize；address / limit 会被忽略，请改用正确键名。');
            }
            const addresses = value.addresses === undefined ? [] : asStringList(value.addresses);
            // `file` used to be mandatory even when every address was a complete action URI. That made the
            // address `explain_skill_actions` / `search_tae_events` had just handed back unusable: the URI
            // `action://c0000/tae/9/A410000` already names the chr container and the TAE section, so asking
            // for the same fact a second time only produced INVALID_INPUT for a correct address. The
            // container is only inferable when every address is a URI pointing at ONE chr; a legacy token
            // (`c1050#A0200`) carries no container, so that case still requires an explicit file.
            const declaredFile = asString(value.file).trim() || undefined;
            let file = declaredFile;
            if (file === undefined) {
                const derived = containerFileFromActionUris(addresses);
                if (!derived.ok)
                    return fail('INVALID_INPUT', derived.message);
                file = derived.file;
            }
            const cursor = value.cursor === undefined ? undefined : asString(value.cursor).trim();
            if (value.cursor !== undefined && !cursor)
                return fail('INVALID_INPUT', 'read_tae_events 的 cursor 必须是非空 opaque token。');
            const pageSize = value.pageSize === undefined ? undefined : asNumber(value.pageSize, 32);
            if (value.projection !== undefined && value.projection !== 'compact') {
                return fail('INVALID_INPUT', 'read_tae_events 的 projection 只能是 "compact"，且需要动作地址；文件预览不支持投影。');
            }
            // search_resources returns the indexed source URI for ACTION containers
            // (for example file://chr/c7100.anibnd.dcx), while the TAE facade needs
            // the current workspace's physical overlay path.  Resolve only this
            // read path through the existing catalog boundary; mutation remains on
            // its legacy resolver and base/read permissions stay unchanged.
            //
            // origin:"base" re-roots the same token on the game base root, so the
            // facade opens the vanilla container with the same reader.
            const originParse = parseReadOrigin(value.origin);
            if (!originParse.ok)
                return fail(originParse.code, originParse.message);
            const origin = originParse.origin;
            const resolvedFile = await resolveReadOriginFile(context, file, 'chr', origin);
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const result = await readTaeEvents({
                edit: edit.session,
                file: nativePathFromFileToken(resolvedFile.path),
                ...(addresses.length > 0 ? { addresses } : {}),
                ...(cursor ? { cursor } : {}),
                ...(typeof value.offset === 'number' ? { offset: value.offset } : {}),
                ...(pageSize === undefined ? {} : { pageSize }),
                ...(value.projection === 'compact' ? { projection: 'compact' } : {}),
                ...(typeof value.expectedSourceHash === 'string' ? { expectedSourceHash: value.expectedSourceHash } : {}),
                ...(typeof value.expectedReaderSchemaRevision === 'number' ? { expectedReaderSchemaRevision: value.expectedReaderSchemaRevision } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.diagnostics);
            // 原版读取不写工作区索引：索引描述的是当前工作区，把 base 的动作合进去会让
            // 之后每一次工作区查询都返回原版值（正是本轮要消除的那类错误答案）。
            if (context.workspaceIndex && origin === 'workspace') {
                // Keep the catalog identity returned by search_resources when the
                // resolver selected a canonical indexed file.  For legacy relative /
                // absolute / bare tokens that remain unindexed, preserve the previous
                // physical-path identity derived from the successful native read.
                const sourceUri = resolvedFile.canonical === true
                    ? resolvedFile.sourceUri
                    : pathToFileURL(result.filePath).href;
                const sourceFile = context.workspaceIndex.getFile(sourceUri);
                // Keep native logical identity and the captured physical file version
                // in separate domains, matching ordinary Bridge envelope ingestion.
                const exportSourceHash = result.sourceHash;
                const readSourceHash = result.sourceHash;
                const sourceRevision = sourceFile?.mtimeMs;
                // The bridge reports the TAE aggregate hash (a decoded-payload identity, D7258BA1… for c6210),
                // not the bytes on disk. Feeding that in as outerFileHash made every merge fail closed as
                // NATIVE_PROJECTION_STALE against the indexed 4CB9900A…, so TAE symbols never reached the
                // index and every TAE reference query answered insufficient_evidence. The physical hash is the
                // one the index compares; keep the aggregate as sourceHash.
                const physicalOuterHash = sourceFile?.sha256 ?? result.outerFileHash ?? result.sourceHash;
                // 同一 TAE source 内不同 section 可以复用 animId；不能按裸数字合并，
                // 否则 AI 看到的事件会跨 a00/a50 串线。
                const animations = new Map();
                for (const action of result.actions) {
                    const key = `${action.taeEntryIndex ?? action.taeEntryId ?? action.taeEntryName ?? 'tae'}:${action.animId}`;
                    animations.set(key, { ...action, eventCount: action.eventCount, eventsComplete: action.eventCount === 0, events: [] });
                }
                for (const event of result.events) {
                    const animationKey = `${event.taeEntryIndex ?? event.taeEntryId ?? event.taeEntryName ?? 'tae'}:${event.animId}`;
                    const animation = animations.get(animationKey) ?? {
                        animId: event.animId,
                        code: event.code,
                        ...(event.taeEntryIndex === undefined ? {} : { taeEntryIndex: event.taeEntryIndex }),
                        ...(event.taeEntryId === undefined ? {} : { taeEntryId: event.taeEntryId }),
                        ...(event.taeEntryName === undefined ? {} : { taeEntryName: event.taeEntryName }),
                        ...(event.taeGroup === undefined ? {} : { taeGroup: event.taeGroup }),
                        events: []
                    };
                    animation.events.push({
                        uri: event.uri,
                        index: event.eventIndex,
                        eventTypeId: event.eventTypeId,
                        ...(event.taeEntryIndex === undefined ? {} : { taeEntryIndex: event.taeEntryIndex }),
                        ...(event.taeEntryId === undefined ? {} : { taeEntryId: event.taeEntryId }),
                        ...(event.taeEntryName === undefined ? {} : { taeEntryName: event.taeEntryName }),
                        ...(event.taeGroup === undefined ? {} : { taeGroup: event.taeGroup }),
                        ...(event.typeName ? { typeName: event.typeName } : {}),
                        startTime: event.startTime,
                        endTime: event.endTime,
                        startFrame: event.startFrame,
                        endFrame: event.endFrame,
                        ...(readSourceHash ? { sourceHash: readSourceHash } : {}),
                        ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                        ...(event.fields ? { fields: event.fields } : {}),
                        ...(event.parameterBytesHex ? { parameterBytesHex: event.parameterBytesHex } : {}),
                        ...(event.decodeStatus ? { decodeStatus: event.decodeStatus } : {}),
                        ...(event.raw ? { raw: event.raw } : {})
                    });
                    animations.set(animationKey, animation);
                }
                context.workspaceIndex.mergeTaeEvents({
                    chrId: result.chrId,
                    readerSchemaRevision: result.readerSchemaRevision,
                    ...(physicalOuterHash ? { outerFileHash: physicalOuterHash } : {}),
                    sourceUri,
                    ...(exportSourceHash ? { sourceHash: exportSourceHash } : {}),
                    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                    ...(result.taeEntryCount !== undefined ? { taeEntryCount: result.taeEntryCount } : {}),
                    ...(result.taeEntries ? { taeEntries: result.taeEntries } : {}),
                    animations: [...animations.values()]
                });
                context.workspaceIndex.rebuildReferences();
                await context.onSemanticEvidenceUpdated?.([sourceUri]);
            }
            // A preview hands back result.pagination.nextCursor, but every other bounded read exposes the
            // cursor and its next call at the record top level. An agentic follow-the-cursor loop therefore
            // stalled on this tool. Mirror them here, and fill in the total the record already knows.
            const pagination = result.pagination;
            const nextCursor = typeof pagination?.nextCursor === 'string' ? pagination.nextCursor : undefined;
            // An unaddressed preview only projects one native animation page, so its event window has no
            // known total: totalEventCount is the whole document's count, not this window's. Filling it made
            // a partial preview claim a total it had not loaded. Only an addressed read covers a known
            // action, where totalEventCount really is the window's total.
            const totalKnown = addresses.length > 0 && typeof result.totalEventCount === 'number'
                ? result.totalEventCount : undefined;
            // pageSize is capped by the byte budget (a container with large event bodies yields three per
            // page even when 50 is requested). Report the effective size and the reason instead of silently
            // ignoring what the caller asked for.
            const requestedPageSize = pageSize === undefined ? undefined : Math.trunc(pageSize);
            const effectivePageSize = requestedPageSize === undefined
                ? (typeof pagination?.pageSize === 'number' ? pagination.pageSize : result.events.length)
                : Math.min(requestedPageSize, Math.max(result.events.length, typeof pagination?.pageSize === 'number' ? pagination.pageSize : result.events.length));
            const pageSizeClamped = requestedPageSize !== undefined && requestedPageSize > effectivePageSize;
            // The event total lived only on actions[0].eventCount for an address read, so a caller that
            // checked record.eventCount (the documented field name) found nothing and had to know the
            // actions array layout. Publish the same total at the top level; keep per-action counts as-is.
            const actionEventCount = Array.isArray(result.actions)
                ? (result.actions)
                    .reduce((total, action) => total + (typeof action?.eventCount === 'number' ? action.eventCount : 0), 0)
                : undefined;
            const withContinuation = {
                ...result,
                // 来源必须随结果返回：同一个 file token 在两个层上是两份不同的字节，
                // 调用方不能靠猜。
                source: readOriginSource(origin, resolvedFile.relativePath),
                // Derived naming on every listed action and TAE child: family, the entry-id decomposition,
                // the animation entry id and the hkx name. See withDerivedNaming above.
                actions: result.actions.map(withDerivedNaming),
                ...(result.taeEntries === undefined ? {} : { taeEntries: result.taeEntries.map(withDerivedNaming) }),
                ...(actionEventCount !== undefined && typeof result.totalEventCount !== 'number'
                    ? { eventCount: actionEventCount, eventCountSource: 'actions' }
                    : (typeof result.totalEventCount === 'number'
                        ? { eventCount: result.totalEventCount, eventCountSource: 'browse-total' }
                        : {})),
                ...(pagination && (pagination.totalCount === null || pagination.pageSize === undefined) && (totalKnown !== undefined || effectivePageSize > 0)
                    ? { pagination: { ...pagination,
                            ...(pagination.totalCount === null && totalKnown !== undefined ? { totalCount: totalKnown } : {}),
                            ...(pagination.pageSize === undefined ? { pageSize: effectivePageSize } : {}) } }
                    : {}),
                ...(pageSizeClamped ? { pageSizeClampedBy: 'tae-byte-budget', requestedPageSize } : {}),
                ...(nextCursor ? {
                    nextCursor,
                    // `origin` is part of the read, not of the window: replaying a base-page cursor without it
                    // re-rooted the request on the workspace and answered TAE_CURSOR_SCOPE_MISMATCH, so the
                    // "replay verbatim" action was not executable for a base read.
                    nextActions: [{ tool: 'read_tae_events', args: { file, ...(addresses.length > 0 ? { addresses } : {}), ...(value.projection === undefined ? {} : { projection: value.projection }), ...(value.pageSize === undefined ? {} : { pageSize: value.pageSize }), ...(origin === 'base' ? { origin } : {}), cursor: nextCursor }, reason: '继续读取后续动作/事件页；带上的 origin/addresses/projection/pageSize 与产生该 cursor 的那次读取一致，可原样回放。' }]
                } : {})
            };
            if (result.projection !== 'compact') {
                // A preview repeats the file-level info diagnostics (the roundtrip inventory, ~13 KB for
                // c0000) on every page, and that repeated block is what crowds out the preview itself.
                // Keep severity/code/message — the diagnostic is still visible — and drop only `details`,
                // exactly as the compact projection already does.
                if (addresses.length > 0)
                    return ok(withContinuation);
                let dropped = false;
                const diagnostics = result.diagnostics.map(diagnostic => {
                    if (diagnostic.severity !== 'info' || diagnostic.details === undefined)
                        return diagnostic;
                    const { details: _omitted, ...rest } = diagnostic;
                    dropped = true;
                    return rest;
                });
                return ok({ ...withContinuation, diagnostics, ...(dropped ? { infoDiagnosticDetailsOmitted: true } : {}) });
            }
            // The index above keeps the full events; only the returned page is compacted. Info diagnostics keep code and
            // message: their details (the container's TAE inventory, about 13 KB for c0000) would repeat on every page.
            return ok({ ...withContinuation, events: result.events.map(compactTaeEvent),
                diagnostics: result.diagnostics.map(diagnostic => {
                    if (diagnostic.severity !== 'info' || diagnostic.details === undefined)
                        return diagnostic;
                    const { details: _omitted, ...rest } = diagnostic;
                    return rest;
                }) });
        }
    };
}
//# sourceMappingURL=read_tae_events.js.map