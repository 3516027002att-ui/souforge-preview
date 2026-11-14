import { asRecord, asStringList, fail, ok, ragSearchFallback, searchQueryUnusable } from '../toolRegistrySupport.js';
import { contentSearchPage, withVariantContext } from '.././contentSearchPage.js';
import { paramContentRevision } from '../../param/containerParamEdit.js';
/**
 * A PARAM row projection now carries two revisions that are deliberately different:
 *
 * - `sourceRevision` is the workspace file mtime. It is the index freshness token that
 *   WorkspaceIndex.compareToIndexedFile / getRagStaleChunkIds compare against IndexedFile.mtimeMs, so it
 *   must keep that meaning; changing it to a content value made every live-read merge look stale.
 * - `contentRevision` is derived from the row's own PARAM child `sourceHash`, so identical bytes always
 *   produce the identical number. This is the value a consumer may use as a CAS/cache key.
 *
 * `sourceRevisionKind` names which rule produced `sourceRevision` (`file-mtime` here, `content-hash` for
 * read_param_fields/mutate_param_fields), so a caller that only sees one of the two tools can still tell
 * whether that number is safe to compare. Never drop the kind and infer it from the magnitude.
 */
function withParamContentIdentity(item) {
    const contentRevision = paramContentRevision(item.sourceHash);
    return {
        ...item,
        ...(item.sourceRevision === undefined ? {} : { sourceRevisionKind: 'file-mtime' }),
        ...(contentRevision === undefined ? {} : { contentRevision })
    };
}
/** search_param_rows: one domain tool declaration, schema and handler. */
export function createSearchParamRowsTool() {
    return {
        name: 'search_param_rows',
        description: 'Search parsed PARAM rows by native row name, row id, field id, display name, '
            + 'field description, or value. Use paramNames to search specific tables such as '
            + 'NpcParam, EquipParamGoods, or ItemLotParam. Results are candidates; use '
            + 'read_param_fields for live native values. limit defaults to 20 (max 32); the response says '
            + 'limitDefaulted and lists total/nextCursor, so a truncated page is never mistaken for the whole answer. '
            + 'Simplified and traditional Chinese are folded for matching (NFKC + 繁→简), so a traditional query '
            + 'also finds simplified row names; matchedBy says exact (the stored rowName contains the query), '
            + 'cjk-variant (equal only after folding), or fuzzy. A zero-hit page lists variantHints (closest '
            + 'row names, one character apart, kept as stored) instead of implying the row does not exist. '
            + 'Each candidate carries two different version fields: `sourceRevision` is the workspace file mtime '
            + '(sourceRevisionKind=file-mtime) and only tracks index freshness, while `contentRevision` is derived '
            + 'from the candidate PARAM child hash and is the value to use as a CAS/cache key. read_param_fields and '
            + 'mutate_param_fields report the same contentRevision with sourceRevisionKind=content-hash. '
            + 'Example: { query: "鬼庭形部", paramNames: ["NpcParam"] }.',
        permission: 'read',
        permissionLevel: 'read',
        // Row discovery must settle before consumers from the same model turn.
        supportsParallel: false,
        inputSchema: { query: 'string?', limit: 'safe-integer?', paramNames: 'array?', offset: 'safe-integer?', cursor: 'string?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            // An empty query matches every one of ~50k rows: correct, but it took over three minutes
            // and only stopped being a crash after the diversifier was made iterative. A caller that
            // omits the term gets a fast, actionable answer instead of a stall.
            const guardValue = asRecord(input);
            const rawQuery = typeof guardValue.query === 'string' ? guardValue.query.trim() : '';
            const tableFilter = Array.isArray(guardValue.paramNames)
                ? guardValue.paramNames.filter((name) => typeof name === 'string' && name.trim() !== '')
                : [];
            if (rawQuery === '' && tableFilter.length === 0) {
                return fail('INVALID_INPUT', 'search_param_rows 需要 query，或用 paramNames 限定表（例如 ["NpcParam"]）。'
                    + '空条件会匹配数万行且极慢，因此不执行。');
            }
            const unusable = searchQueryUnusable(rawQuery);
            if (unusable !== undefined)
                return fail('SEARCH_QUERY_UNUSABLE', unusable);
            const paramState = typeof ws.getParamSemanticState === 'function' ? ws.getParamSemanticState() : 'ready';
            if (paramState === 'warming_up') {
                return ok({
                    status: 'warming_up',
                    directive: 'DEFER_PARAM_QUERY',
                    state: 'warming_up',
                    totalHits: 0,
                    hits: [],
                    message: '【状态机调度】PARAM 语义索引当前正在后台解包预热中（尚未就绪）。请当前循环暂时跳过参数查询流程，优先执行其他可独立推进的任务（如 MSB 地图分析、EMEVD 事件逻辑校验、任务规划等）；请在下一次循环或后续步骤中再重新查询参数。'
                });
            }
            const value = asRecord(input);
            try {
                const page = contentSearchPage({
                    tool: 'search_param_rows', workspaceId: ws.workspaceId, input: value,
                    // The old default of 6 cut a 7-row answer (鬼形部) by one row with no explanation.
                    // A row search page is small, so default to 20 and say the default was used.
                    defaultLimit: 20,
                    search: (query, paramNames) => ws.searchParamRows(query, Number.MAX_SAFE_INTEGER, paramNames.length > 0 ? paramNames : undefined),
                    // The fingerprint is taken inside contentSearchPage over the unprojected rows, so the
                    // derived contentRevision below cannot change an in-flight cursor's source hash.
                    fingerprint: ({ item, score }) => [item.uri, score, item.rowName, item.sourceHash, item.outerFileHash, item.sourceRevision, item.dataHash]
                });
                // Attach the content identity after the page (and cursor) were computed. The row's
                // `sourceRevision` stays the index's mtime freshness token; `contentRevision` is the
                // per-child content version that stays identical across a write+rollback.
                const projectedPage = withVariantContext(page, 'search_param_rows', (query) => ws.suggestVariantParamRows(query, 5, tableFilter.length > 0 ? tableFilter : undefined), (row) => ({ text: row.rowName ?? '', rowName: row.rowName, paramName: row.paramName, rowId: row.rowId, uri: row.uri }));
                const withMatches = {
                    ...projectedPage,
                    matches: page.matches.map((match) => ({ ...match, item: withParamContentIdentity(match.item) }))
                };
                if (page.total > 0 || value.cursor !== undefined)
                    return ok(withMatches);
                // A zero-hit search used to swap the whole response for the RAG fallback, which renamed
                // matches to hits and filled it with corpus documents. Callers read one contract, so keep
                // the page shape and nest the fallback instead of replacing it.
                const fallbackPayload = await ragSearchFallback(context, page.query, ['param_row'], page.limit, 'search_param_rows', asStringList(value.paramNames));
                // A zero-hit search whose RAG aid is unavailable is not a confident "no such row".
                // Before a3cca800 the failure was returned whole; that commit nested the successful
                // fallback but dropped this branch, so RAG_UNAVAILABLE became indistinguishable from
                // "the table has no matching rows" — the exact silent-zero the callers must not see.
                // Nested data keeps one shape; a failure the aid reports is still a failure.
                if (fallbackPayload.ok !== true)
                    return fallbackPayload;
                return ok({ ...withMatches, fallback: fallbackPayload.data });
            }
            catch (error) {
                return fail(error.code ?? 'CONTENT_SEARCH_FAILED', error instanceof Error ? error.message : '参数搜索失败。');
            }
        }
    };
}
//# sourceMappingURL=search_param_rows.js.map