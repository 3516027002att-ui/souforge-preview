import { asRecord, fail, ok, ragSearchFallback } from '../toolRegistrySupport.js';
import { contentSearchPage, withVariantContext } from '.././contentSearchPage.js';
/** search_text_entries: one domain tool declaration, schema and handler. */
export function createSearchTextEntriesTool() {
    return {
        name: 'search_text_entries',
        description: 'Search parsed MSG/FMG text entries by visible text or text id. '
            + 'Every FMG table inside every msg container is indexed; category is the native table path '
            + '(<lang>/<container>/<table>) and keeps the table spelling exactly as the BND4 stores it '
            + '(for example zhocn/item/NPC名 or zhocn/menu/NTC_メニューテキスト), so it can be fed straight '
            + 'back to read_fmg_entries or explain_text_entry. '
            + 'Use this in parallel with search_param_rows when resolving a character or item; '
            + 'textId is not automatically a PARAM rowId. '
            + 'Simplified and traditional Chinese are folded for matching (NFKC + 繁→简), so a traditional '
            + 'query also finds simplified data; each match says how it hit: matchedBy exact (the stored text '
            + 'contains the query), cjk-variant (equal only after folding: the data uses different characters), '
            + 'or fuzzy. When nothing matches, variantHints lists the closest entries and the response says the '
            + 'wording probably differs, instead of implying the text does not exist. The returned text/textId '
            + 'are always the data as stored, never the folded form.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { query: 'string?', limit: 'safe-integer?', offset: 'safe-integer?', cursor: 'string?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const variantContext = (page, note) => withVariantContext(page, 'search_text_entries', (query) => ws.suggestVariantTextEntries(query, 5), (entry) => ({ text: entry.text, textId: entry.textId, category: entry.category, uri: entry.uri }), note);
            try {
                const page = contentSearchPage({
                    tool: 'search_text_entries', workspaceId: ws.workspaceId, input: value,
                    search: (query) => ws.searchTextEntries(query, Number.MAX_SAFE_INTEGER),
                    fingerprint: ({ item, score }) => [item.uri, score, item.text, item.sourceHash, item.outerFileHash, item.sourceRevision]
                });
                if (page.total > 0 || value.cursor !== undefined)
                    return ok(variantContext(page));
                const fallback = await ragSearchFallback(context, page.query, ['text_entry'], page.limit, 'search_text_entries');
                // Zero hits is not proof that the text is absent: the workspace may carry no indexed text
                // yet, or only a language other than the default. Say which instead of a bare empty page.
                const indexed = ws.toSymbolBundle().msgs?.reduce((acc, msg) => acc + (msg.entries?.length ?? 0), 0) ?? 0;
                const note = indexed > 0
                    ? `文本索引里有 ${indexed} 条。换更短的关键词或直接用 textId。`
                    : '工作区还没有已索引的文本条目（可能只存在非默认语言的 msg 容器，或尚未读取）。'
                        + '用 read_fmg_entries 指定 containerPath（例如 msg/engus/item.msgbnd.dcx）读取该表后再搜索。';
                // A zero-hit search used to answer with the RAG payload (hits/availability) instead of the
                // page, so callers read one shape on a hit and another on a miss. Keep the page, nest the
                // corpus hits, and say why nothing matched.
                // An unavailable corpus is not a clean miss: report it as the failure it is instead of
                // a page whose only difference from "nothing matched" is a sentence of note text.
                if (!fallback.ok)
                    return fallback;
                const fallbackData = fallback.data && typeof fallback.data === 'object'
                    ? fallback.data
                    : undefined;
                return ok({
                    ...variantContext(page, note),
                    ...(fallbackData === undefined ? {} : { fallback: fallbackData })
                });
            }
            catch (error) {
                return fail(error.code ?? 'CONTENT_SEARCH_FAILED', error instanceof Error ? error.message : '文本搜索失败。');
            }
        }
    };
}
//# sourceMappingURL=search_text_entries.js.map