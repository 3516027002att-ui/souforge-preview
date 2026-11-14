import { asIdList, asOptionalString, asRecord, asString, fail, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readFmgEntries, readFmgEntryPage } from '../../editing/fmgEdit.js';
import { pathToFileURL } from 'node:url';
import { sourceTextPage } from '.././sourceTextPage.js';
/**
 * A 400-id request used to be all-or-nothing: the reader assembled every entry,
 * the Agent envelope crossed 64 KiB, and the whole batch failed with
 * RESULT_TEXT_WINDOW_TOO_LARGE — even though each entry was small. The budget
 * below is spent inside this tool, on rows the caller can actually see, so a
 * batch is returned page by page instead of failing as a unit.
 *
 * Calibration on msg/zhocn/item.msgbnd.dcx (アイテム説明, 400 ids, median entry
 * 87 chars): an entry row costs about 444 JSON bytes at that median, and the
 * envelope's fixed part (envelope + capped evidence + diagnostics + the echoed
 * ids in nextActions) tops out near 11 KiB. 44 KiB of rows therefore keeps a
 * whole page inside the 64 KiB Agent bound with ~9 KiB of slack.
 */
const FMG_ENTRY_PAGE_BUDGET_BYTES = 44 * 1024;
/** nextActions must be replayable, but not at the cost of the page it describes. */
const FMG_NEXT_ACTION_ID_ECHO_BYTES = 6 * 1024;
const FMG_ENTRY_ROW_OVERHEAD_BYTES = 8;
/** Mirrors the tool's own row estimate; a caller-supplied limit is an upper bound, never a promise to overflow. */
function fmgEntryRowBytes(entry) {
    return Buffer.byteLength(JSON.stringify(entry), 'utf8') + FMG_ENTRY_ROW_OVERHEAD_BYTES;
}
/**
 * Page over the caller's ids, not over the entries that happened to be found.
 *
 * readFmgEntries returns one entry per *found* id, in request order. Indexing the
 * page by entry position would silently shift every page after a missing id, so
 * the offset stays an index into the ids array the caller passed: positions[k] is
 * where the k-th found entry sits in that array, and a page starts at the first
 * found entry at or after `offset`.
 */
function selectFmgEntryPage(ids, entries, offset, limit, budgetBytes = FMG_ENTRY_PAGE_BUDGET_BYTES) {
    const positions = [];
    for (let index = 0, found = 0; index < ids.length && found < entries.length; index += 1) {
        if (entries[found].id === ids[index]) {
            positions.push(index);
            found += 1;
        }
    }
    let start = 0;
    while (start < positions.length && positions[start] < offset)
        start += 1;
    let bytes = 0;
    let count = 0;
    while (start + count < positions.length) {
        if (limit !== undefined && count >= limit)
            break;
        const rowBytes = fmgEntryRowBytes(entries[start + count]);
        // The first row is always returned: a single huge entry is then windowed by
        // sourceTextPage below, which is the existing (and honest) continuation for it.
        if (count > 0 && bytes + rowBytes > budgetBytes)
            break;
        bytes += rowBytes;
        count += 1;
    }
    const pageEntries = entries.slice(start, start + count);
    const remainingCount = entries.length - start - count;
    const hasMore = remainingCount > 0;
    // The next page starts right after the last id this page consumed, so ids that
    // were not found are skipped instead of being re-scanned as a phantom page.
    const nextOffset = count > 0 ? positions[start + count - 1] + 1 : offset;
    return {
        entries: pageEntries,
        offset,
        returnedCount: count,
        totalCount: entries.length,
        remainingCount,
        hasMore,
        truncated: offset > 0 || hasMore,
        ...(hasMore ? { nextOffset } : {}),
        pagination: {
            offset,
            limit: count,
            returnedCount: count,
            totalCount: entries.length,
            remainingCount,
            hasMore,
            ...(hasMore ? { nextOffset } : {})
        }
    };
}
/** A page must not exceed the same byte budget the id-paged read already respects. */
function trimFmgEntriesByBudget(entries, budgetBytes) {
    const kept = [];
    let bytes = 0;
    for (const entry of entries) {
        const rowBytes = fmgEntryRowBytes(entry);
        if (kept.length > 0 && bytes + rowBytes > budgetBytes)
            break;
        bytes += rowBytes;
        kept.push(entry);
    }
    return kept;
}
/** read_fmg_entries: one domain tool declaration, schema and handler. */
export function createReadFmgEntriesTool() {
    return {
        name: 'read_fmg_entries',
        description: 'Read live FMG text entries from a confirmed msgbnd table. '
            + 'Pass table name (logical, e.g. Title) and entry ids. '
            + 'A batch is returned in byte-bounded pages instead of failing: the record carries returnedCount/totalCount/remainingCount/hasMore and nextOffset (an index into your ids array), so a 400-id request comes back page by page and never as one RESULT_TEXT_WINDOW_TOO_LARGE failure. Pass offset (and optionally limit) to resume; limit shrinks automatically when the next rows would cross the Agent budget. '
            + 'Whole-table entry enumeration: pass allEntries:true with table and offset/limit (no ids). The page returns entries in native table order with entryIndex, plus entryCount/entryReturned/hasMore/nextOffset. '
            + 'This is the read that can authorize adding a new entry: mutate_fmg_entries falls back to the container proof, and that proof requires the union of enumerated pages to cover every entry [0, entryCount) — read from offset=0 until hasMore=false. Reading a few ids (or one page) proves only those ids, never the whole table. '
            + 'For one long entry read a single id with sourceOffset/sourceLimit or its nextCursor to continue its actual text. Do not treat FMG as UTF-8.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string',
            ids: 'array?',
            containerPath: 'string?',
            lang: 'string?',
            offset: 'safe-integer?',
            limit: 'safe-integer?',
            cursor: 'string?',
            sourceOffset: 'safe-integer?',
            sourceLimit: 'safe-integer?',
            allEntries: 'boolean?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const table = asString(value.table);
            const allEntries = value.allEntries === true;
            if (allEntries) {
                if (!table) {
                    return fail('INVALID_INPUT', 'read_fmg_entries 的整表条目枚举需要 table。');
                }
                const entryOffset = value.offset === undefined ? 0 : value.offset;
                if (typeof entryOffset !== 'number' || !Number.isSafeInteger(entryOffset) || entryOffset < 0) {
                    return fail('INVALID_INPUT', 'read_fmg_entries 的 offset 必须是 ≥0 的安全整数（0 表示第一条）。');
                }
                if (value.limit !== undefined && (typeof value.limit !== 'number' || !Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 512)) {
                    return fail('INVALID_INPUT', 'read_fmg_entries 的 limit 必须是 1–512 的安全整数。');
                }
                const containerPath = asOptionalString(value.containerPath);
                const lang = asOptionalString(value.lang);
                const page = await readFmgEntryPage({
                    edit: edit.session,
                    table,
                    ...(containerPath ? { containerPath } : {}),
                    ...(lang ? { lang } : {}),
                    offset: entryOffset,
                    ...(typeof value.limit === 'number' ? { limit: value.limit } : {})
                });
                if (!page.ok)
                    return fail(page.error.code, page.error.message, page.error.details);
                const kept = trimFmgEntriesByBudget(page.entries, FMG_ENTRY_PAGE_BUDGET_BYTES);
                const entryReturned = kept.length;
                const hasMore = page.hasMore || entryReturned < page.entries.length;
                const nextOffset = hasMore ? page.entryOffset + entryReturned : undefined;
                const resolved = resolveIndexedResourceFile(context, page.containerPath, 'msg');
                const sourceUri = resolved.ok ? resolved.sourceUri : pathToFileURL(page.containerPath).href;
                return ok({
                    allEntries: true,
                    containerPath: page.containerPath,
                    table: page.table,
                    sourceUri,
                    entryCount: page.entryCount,
                    entryOffset: page.entryOffset,
                    entryLimit: page.entryLimit,
                    entryReturned,
                    hasMore,
                    ...(nextOffset === undefined ? {} : { nextOffset }),
                    totalCount: page.entryCount,
                    returnedCount: entryReturned,
                    remainingCount: Math.max(0, page.entryCount - page.entryOffset - entryReturned),
                    entries: kept,
                    ...(page.sourceHash ? { sourceHash: page.sourceHash } : {}),
                    ...(page.sourceRevision === undefined ? {} : { sourceRevision: page.sourceRevision }),
                    diagnostics: page.diagnostics,
                    pagination: {
                        offset: page.entryOffset,
                        returnedCount: entryReturned,
                        totalCount: page.entryCount,
                        hasMore,
                        ...(nextOffset === undefined ? {} : { nextOffset })
                    },
                    nextActions: nextOffset === undefined ? [] : [{
                            tool: 'read_fmg_entries',
                            args: {
                                table: page.table,
                                allEntries: true,
                                offset: nextOffset,
                                ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
                                ...(containerPath ? { containerPath } : {}),
                                ...(lang ? { lang } : {})
                            },
                            reason: `继续枚举整表条目：还差 ${Math.max(0, page.entryCount - nextOffset)} 条；翻到 hasMore=false 才能授权新增条目。`
                        }]
                });
            }
            const ids = asIdList(value.ids);
            if (!table || ids.length === 0) {
                return fail('INVALID_INPUT', 'read_fmg_entries 需要 table、ids（整表枚举用 allEntries:true + table + offset）。');
            }
            const pageOffset = value.offset === undefined ? 0 : value.offset;
            const pageLimit = value.limit === undefined ? undefined : value.limit;
            if (typeof pageOffset !== 'number' || !Number.isSafeInteger(pageOffset) || pageOffset < 0) {
                return fail('INVALID_INPUT', 'read_fmg_entries 的 offset 必须是 ids 数组里的非负安全整数下标。');
            }
            if (pageLimit !== undefined && (typeof pageLimit !== 'number' || !Number.isSafeInteger(pageLimit) || pageLimit < 1)) {
                return fail('INVALID_INPUT', 'read_fmg_entries 的 limit 必须是正整数。');
            }
            if ((value.cursor !== undefined || value.sourceOffset !== undefined || value.sourceLimit !== undefined) && ids.length !== 1) {
                return fail('FMG_SOURCE_WINDOW_SINGLE_ENTRY', '展开正文时 ids 必须只有一个文本条目。');
            }
            const containerPath = asOptionalString(value.containerPath);
            const lang = asOptionalString(value.lang);
            const result = await readFmgEntries({
                edit: edit.session,
                table,
                ids,
                ...(containerPath ? { containerPath } : {}),
                ...(lang ? { lang } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.error.details);
            // Paging is a view over the ids the caller asked for. A 1-id read keeps its
            // existing single-entry text-window contract untouched; multi-id reads page.
            // The echoed id list is what makes nextActions replayable, so its bytes come
            // out of the same page budget instead of riding on top of it.
            const idEchoBytes = Buffer.byteLength(JSON.stringify(ids), 'utf8');
            const echoedIds = idEchoBytes <= FMG_NEXT_ACTION_ID_ECHO_BYTES ? ids : undefined;
            const page = result.entries.length > 1 || pageOffset > 0
                ? selectFmgEntryPage(ids, result.entries, Math.min(pageOffset, ids.length), pageLimit, FMG_ENTRY_PAGE_BUDGET_BYTES - Math.min(idEchoBytes, FMG_NEXT_ACTION_ID_ECHO_BYTES))
                : undefined;
            if (pageOffset > ids.length) {
                return fail('FMG_PAGE_OFFSET_OUT_OF_RANGE', `offset ${pageOffset} 超出 ids 数组长度 ${ids.length}（该表命中 ${result.entries.length} 条）。`);
            }
            if (context.workspaceIndex && result.entries.length > 0) {
                const resolved = resolveIndexedResourceFile(context, result.containerPath, 'msg');
                const sourceUri = resolved.ok ? resolved.sourceUri : pathToFileURL(result.containerPath).href;
                const hashes = new Set(result.entries.map((entry) => entry.sourceHash).filter((hash) => Boolean(hash)));
                const revisions = new Set(result.entries.map((entry) => entry.sourceRevision).filter((revision) => revision !== undefined));
                const sourceHash = hashes.size === 1 ? [...hashes][0] : undefined;
                const sourceRevision = revisions.size === 1 ? [...revisions][0] : undefined;
                // Table names are native BND4 spellings (`NTC_メニューテキスト`,
                // `NPC名`), but callers may hand back the lowercased form from an
                // older search hit.  Match case-insensitively so a direct read
                // merges into the indexed table instead of inserting a second
                // table with the same rows under a different spelling.
                const wantedTable = result.table.toLocaleLowerCase();
                const indexedTable = context.workspaceIndex.toSymbolBundle().msgs?.find((item) => (item.entries.some((entry) => entry.sourceUri === sourceUri)
                    && ((item.category ?? '').toLocaleLowerCase() === wantedTable
                        || (item.category ?? '').toLocaleLowerCase().endsWith(`/${wantedTable}`))));
                const category = indexedTable?.category ?? result.table;
                context.workspaceIndex.mergeMsgEntries({
                    category,
                    ...(sourceHash ? { sourceHash } : {}),
                    ...(sourceHash ? { outerFileHash: sourceHash } : {}),
                    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                    entries: result.entries.map((entry) => ({
                        ...indexedTable?.entries.find((old) => old.textId === entry.id && old.sourceUri === sourceUri),
                        uri: indexedTable?.entries.find((old) => old.textId === entry.id && old.sourceUri === sourceUri)?.uri ?? `${sourceUri}#${result.table}/${entry.id}`,
                        sourceUri,
                        category,
                        textId: entry.id,
                        text: entry.text ?? '',
                        confidence: 'high',
                        ...(entry.sourceHash ? { sourceHash: entry.sourceHash } : {}),
                        ...(entry.sourceHash ? { outerFileHash: entry.sourceHash } : {}),
                        ...(entry.sourceRevision !== undefined ? { sourceRevision: entry.sourceRevision } : {})
                    }))
                });
                context.workspaceIndex.rebuildReferences();
                await context.onSemanticEvidenceUpdated?.([sourceUri]);
            }
            const pageNextActions = page?.hasMore
                ? [{ tool: 'read_fmg_entries',
                        args: { table: result.table, ...(echoedIds ? { ids: echoedIds } : {}), containerPath: result.containerPath, ...(lang ? { lang } : {}), offset: page.nextOffset, ...(pageLimit === undefined ? {} : { limit: pageLimit }) },
                        reason: echoedIds
                            ? `继续读取下一批条目；还差 ${page.remainingCount} 条。`
                            : `继续读取下一批条目：沿用本次请求的 ids（${ids.length} 个），只把 offset 改成 ${page.nextOffset}；还差 ${page.remainingCount} 条。` }]
                : [];
            if (!page && result.entries.length === 1 && typeof result.entries[0].text === 'string') {
                const entry = result.entries[0];
                try {
                    const resolved = resolveIndexedResourceFile(context, result.containerPath, 'msg');
                    const sourceUri = resolved.ok ? resolved.sourceUri : result.containerPath;
                    const { sourceText, ...textPage } = sourceTextPage({
                        text: entry.text,
                        sourceKey: `${context.workspaceIndex?.workspaceId ?? edit.session.session.meta.workspaceId}|${sourceUri}|${result.table}|${entry.id}`,
                        sourceHash: entry.sourceHash ?? '', domain: 'fmg',
                        ...(value.sourceOffset !== undefined ? { sourceOffset: value.sourceOffset } : {}),
                        ...(value.sourceLimit !== undefined ? { sourceLimit: value.sourceLimit } : {}),
                        ...(value.cursor !== undefined ? { cursor: value.cursor } : {})
                    });
                    return ok({ ...result, sourceUri, entries: [{ ...entry, text: sourceText }], ...textPage,
                        nextActions: textPage.nextCursor ? [{ tool: 'read_fmg_entries',
                                args: { table: result.table, ids: [entry.id], containerPath: result.containerPath, cursor: textPage.nextCursor },
                                reason: '继续读取该条目的后续文本' }] : [] });
                }
                catch (error) {
                    return fail(error.code ?? 'SOURCE_WINDOW_FAILED', error instanceof Error ? error.message : '文本窗口读取失败。');
                }
            }
            if (!page)
                return ok(result);
            return ok({ ...result, entries: page.entries, offset: page.offset, returnedCount: page.returnedCount,
                totalCount: page.totalCount, remainingCount: page.remainingCount, hasMore: page.hasMore,
                truncated: page.truncated, ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
                pagination: page.pagination, ...(pageNextActions.length > 0 ? { nextActions: pageNextActions } : {}) });
        }
    };
}
//# sourceMappingURL=read_fmg_entries.js.map