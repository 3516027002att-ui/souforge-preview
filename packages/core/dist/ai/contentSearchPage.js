import { createHash } from 'node:crypto';
import { createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
import { cursorIdentity } from '../workspace/cursorIdentity.js';
import { normalizeCjkMatchForm } from '../indexing/cjkVariants.js';
// v3: the wire scope carries cursorIdentity(workspaceId), never the workspace
// URL. v1/v2 tokens embedded the absolute workspace path and are rejected; a
// cursor is only a session-local paging token, so the agent simply re-queries.
const CONTENT_SEARCH_SESSION = 'content-search-v3';
function invalid(message, code = 'SEARCH_CURSOR_SCOPE_MISMATCH') {
    throw Object.assign(new Error(message), { code });
}
/**
 * 给一页搜索结果补上“这次是按哪个字形命中的”。
 *
 * - `normalizedQuery` 只在折叠真的改变了问句时出现：调用方据此知道自己给的繁体字被当成了简体。
 * - 零命中时不算完：`variantHints` 给出最接近的数据原文（等长、只差一个字），并把
 *   “可能用字不同，数据里写作 X” 写进 note / nextActions，而不是让「没有匹配」冒充「不存在」。
 *   这一类缺陷（用户写「绣丸」、数据写「锈丸」）繁简表救不了：两个字互不为繁简。
 */
export function withVariantContext(page, tool, suggest, project, note) {
    const trimmed = page.query.trim();
    const normalized = trimmed.length > 0 ? normalizeCjkMatchForm(trimmed) : '';
    const normalizedQuery = normalized.length > 0 && normalized !== trimmed ? normalized : undefined;
    const base = { ...page, ...(normalizedQuery === undefined ? {} : { normalizedQuery }) };
    if (page.total > 0)
        return { ...base, ...(note === undefined ? {} : { note }) };
    const hints = suggest(page.query).map(project);
    if (hints.length === 0)
        return { ...base, ...(note === undefined ? {} : { note }) };
    const firstText = String(hints[0].text);
    const hintNote = `没有逐字命中「${page.query}」，但有一条只差一个字的条目「${firstText}」：可能是用字不同`
        + '（同音/形近/异体），不是数据不存在。variantHints 是按接近程度排的候选，text 保持数据原文。';
    return {
        ...base,
        variantHints: hints,
        nextActions: [{
                tool,
                args: { query: firstText },
                reason: `用字可能不同：数据里写作「${firstText}」，直接用这个写法再搜一次。`
            }],
        note: note === undefined ? hintNote : `${hintNote} ${note}`
    };
}
/** The window a content search may return in one page; the caller's limit is honoured up to this. */
const MAX_CONTENT_WINDOW = 32;
export function contentSearchPage(options) {
    const input = options.input;
    const limitDefaulted = input.limit === undefined;
    const requestedLimit = input.limit ?? options.defaultLimit ?? 6;
    if (typeof requestedLimit !== 'number' || !Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
        invalid('limit 必须是正整数。', 'INVALID_SEARCH_WINDOW');
    }
    // A query that lost its letters and digits (a shell pipe re-encoded "鬼形部" into "???") searched
    // for nothing and still answered "complete" with zero hits, which reads as "does not exist".
    const rawQuery = typeof input.query === 'string' ? input.query.trim() : '';
    if (rawQuery !== '' && !/[\p{L}\p{N}]/u.test(rawQuery)) {
        throw Object.assign(new Error('查询里没有任何文字或数字（收到的是「' + rawQuery + '」）。常见原因是 shell/管道把中文重新编码成了 ?；'
            + '请把参数写成 UTF-8 文件再传入，或改用 ASCII 名称、ID。'), { code: 'SEARCH_QUERY_UNUSABLE' });
    }
    const paramNames = Array.isArray(input.paramNames)
        ? input.paramNames.filter((value) => typeof value === 'string').map((name) => name.trim()).filter(Boolean).sort()
        : [];
    let scope = {
        workspaceId: options.workspaceId, tool: options.tool,
        query: typeof input.query === 'string' ? input.query : '',
        paramNames, limit: Math.min(MAX_CONTENT_WINDOW, requestedLimit)
    };
    let offset = input.offset ?? 0;
    let expectedHash;
    const domain = options.tool === 'search_param_rows' ? 'param' : options.tool === 'search_tae_events' ? 'tae' : 'fmg';
    if (input.cursor !== undefined) {
        if (typeof input.cursor !== 'string' || input.offset !== undefined)
            invalid('续页只传 cursor，不同时传 offset。');
        const payload = parseOpaqueCursor(input.cursor);
        if (payload.sessionId !== CONTENT_SEARCH_SESSION || payload.domain !== domain)
            invalid('游标不属于当前内容搜索，请重新搜索。');
        let parsed;
        try {
            parsed = JSON.parse(payload.scope);
        }
        catch {
            invalid('搜索游标范围无效。');
        }
        if (!parsed || parsed.workspaceId !== cursorIdentity(options.workspaceId) || parsed.tool !== options.tool
            || typeof parsed.query !== 'string' || !Array.isArray(parsed.paramNames)
            || parsed.paramNames.some((name) => typeof name !== 'string')
            || !Number.isSafeInteger(parsed.limit) || parsed.limit < 1 || parsed.limit > MAX_CONTENT_WINDOW)
            invalid('游标与当前工作区或搜索工具不匹配。');
        if ((input.query !== undefined && input.query !== parsed.query)
            || (input.paramNames !== undefined && JSON.stringify(paramNames) !== JSON.stringify(parsed.paramNames)))
            invalid('续页时不能改变搜索条件。');
        if (input.limit !== undefined && scope.limit > parsed.limit)
            invalid('恢复当前页只能缩小窗口，不能扩大 limit。');
        // Restore the real workspace id in memory only; it never returns to the wire.
        scope = { ...parsed, workspaceId: options.workspaceId, limit: input.limit === undefined ? parsed.limit : scope.limit };
        offset = payload.offset;
        expectedHash = payload.sourceHash;
    }
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)
        invalid('offset 必须是非负整数。', 'INVALID_SEARCH_WINDOW');
    const all = options.search(scope.query, scope.paramNames);
    // Window size is a delivery choice, not query/snapshot identity. A failed
    // transport can retry the current cursor with fewer rows without skipping it.
    const { limit: _windowSize, ...snapshotScope } = scope;
    const hash = createHash('sha256').update(JSON.stringify(snapshotScope));
    for (const match of all)
        hash.update('\0').update(JSON.stringify(options.fingerprint(match)));
    const sourceHash = hash.digest('hex');
    if (expectedHash !== undefined && expectedHash !== sourceHash)
        invalid('搜索结果已变化，请重新搜索。', 'STALE_READ_CURSOR');
    const matches = all.slice(offset, offset + scope.limit);
    const end = offset + matches.length;
    const truncated = end < all.length;
    const nextCursor = truncated ? createOpaqueCursor({
        sessionId: CONTENT_SEARCH_SESSION, domain,
        scope: JSON.stringify({ ...scope, workspaceId: cursorIdentity(options.workspaceId) }), sourceHash, offset: end
    }) : undefined;
    return {
        query: scope.query, matches, total: all.length, totalCount: all.length,
        offset, limit: scope.limit, limitDefaulted, returned: matches.length, returnedCount: matches.length,
        truncated, ...(nextCursor ? { nextCursor } : {}),
        // The next action has to be executable as written. A cursor-only replay reached the tool's own
        // entry guard first and answered INVALID_INPUT ("需要 query，或 paramNames"), because that guard
        // runs before this pager ever sees the cursor. Carry the terms that define the search — they are
        // immutable for this cursor, so echoing them cannot change the answer.
        nextActions: nextCursor ? [{
                tool: options.tool,
                args: {
                    ...(scope.query === '' ? {} : { query: scope.query }),
                    ...(scope.paramNames.length === 0 ? {} : { paramNames: scope.paramNames }),
                    cursor: nextCursor
                },
                reason: '继续读取后续搜索结果'
            }] : []
    };
}
//# sourceMappingURL=contentSearchPage.js.map