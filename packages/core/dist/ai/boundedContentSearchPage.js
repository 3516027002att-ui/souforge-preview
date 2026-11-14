import { createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
import { createHash } from 'node:crypto';
import { cursorIdentity } from '../workspace/cursorIdentity.js';
// v2: scope.workspaceId is cursorIdentity(workspaceId); v1 embedded the absolute
// workspace URL and is rejected by the existing "旧搜索游标" diagnostic below.
const BOUNDED_SESSION = 'bounded-content-search-v2';
function invalid(message, code = 'SEARCH_CURSOR_SCOPE_MISMATCH') { throw Object.assign(new Error(message), { code }); }
/** The field filter and the weapon scope are part of the search, not of the window: a continuation
 *  that drops or changes one would answer a different question under the same cursor. A weaponId
 *  continuation used to drop its action-group filter and return every action in the container. */
function filterScope(input) {
    const parts = [];
    const name = typeof input.fieldName === 'string' ? input.fieldName.trim() : '';
    const value = input.fieldValue === undefined ? '' : String(input.fieldValue).trim();
    if (!(name === '' && value === ''))
        parts.push(`field\0${name}\0${value}`);
    if (input.weaponId !== undefined)
        parts.push(`weapon\0${String(input.weaponId)}`);
    return parts.join('\0');
}
/** Provider-owned paging: cursor identity includes its versioned ordering contract. */
export function boundedContentSearchPage(options) {
    const input = options.input;
    let query = typeof input.query === 'string' ? input.query : '', limit = input.limit ?? 6, offset = input.offset ?? 0;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)
        invalid('limit 必须是正整数。', 'INVALID_SEARCH_WINDOW');
    limit = Math.min(6, limit);
    let continuation, expectedHash;
    if (input.cursor !== undefined) {
        if (typeof input.cursor !== 'string' || input.offset !== undefined)
            invalid('续页只传 cursor，不同时传 offset。');
        const cursor = parseOpaqueCursor(input.cursor);
        if (cursor.sessionId !== BOUNDED_SESSION || cursor.domain !== 'tae')
            invalid('旧搜索游标或其他工具游标不能用于当前提供方，请重新搜索。');
        let scope;
        try {
            scope = JSON.parse(cursor.scope);
        }
        catch {
            invalid('搜索游标范围无效。');
        }
        if (!scope || scope.workspaceId !== cursorIdentity(options.workspaceId) || scope.tool !== options.tool || scope.provider !== options.provider
            || typeof scope.query !== 'string' || typeof scope.continuation !== 'string'
            || !Number.isSafeInteger(scope.limit) || scope.limit < 1 || scope.limit > 6)
            invalid('搜索游标与工作区或提供方不匹配。');
        if (input.query !== undefined && input.query !== scope.query)
            invalid('续页不能改变查询。');
        if (filterScope(input) !== (typeof scope.fieldFilter === 'string' ? scope.fieldFilter : ''))
            invalid('续页不能改变或丢掉 fieldName/fieldValue 或 weaponId 过滤条件。');
        if (input.limit !== undefined && limit > scope.limit)
            invalid('续页只能缩小窗口。');
        query = scope.query;
        limit = input.limit === undefined ? scope.limit : limit;
        offset = cursor.offset;
        continuation = scope.continuation;
        expectedHash = cursor.sourceHash;
    }
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0)
        invalid('offset 必须是非负整数。', 'INVALID_SEARCH_WINDOW');
    const window = { offset: offset, limit: limit, ...(continuation === undefined ? {} : { continuation }) };
    const page = options.readPage(query, window);
    const snapshotHash = createHash('sha256').update(JSON.stringify([options.workspaceId, options.tool, options.provider, query, page.snapshotId])).digest('hex');
    if (expectedHash !== undefined && expectedHash !== snapshotHash)
        invalid('搜索快照已变化，请重新搜索。', 'STALE_READ_CURSOR');
    const end = window.offset + page.matches.length;
    const nextCursor = page.continuation === undefined ? undefined : createOpaqueCursor({ sessionId: BOUNDED_SESSION, domain: 'tae',
        sourceHash: snapshotHash, offset: end, scope: JSON.stringify({ workspaceId: cursorIdentity(options.workspaceId), tool: options.tool,
            provider: options.provider, query, limit, continuation: page.continuation, fieldFilter: filterScope(input) }) });
    // The action has to be executable verbatim: a native scan binds its cursor to the scanned file
    // (provider 'tae-native-scan-v1:<uri>'), so a cursor-only replay resubmitted without `file`
    // resolved to the indexed provider and answered "搜索游标与工作区或提供方不匹配". Echo the
    // search terms that are immutable for this cursor; the pager still rejects any real change.
    const replayArgs = { ...(typeof input.file === 'string' ? { file: input.file } : {}),
        ...(typeof input.fieldName === 'string' ? { fieldName: input.fieldName } : {}),
        ...(input.fieldValue !== undefined ? { fieldValue: input.fieldValue } : {}),
        ...(input.weaponId !== undefined ? { weaponId: input.weaponId } : {}),
        ...(input.pageSize !== undefined ? { pageSize: input.pageSize } : {}), cursor: nextCursor };
    return { query, matches: page.matches, total: page.total, totalCount: page.total, offset: window.offset, limit: window.limit,
        returned: page.matches.length, returnedCount: page.matches.length, truncated: nextCursor !== undefined,
        coverage: 'indexed-snapshot', ...(nextCursor ? { nextCursor } : {}),
        nextActions: nextCursor ? [{ tool: options.tool, args: replayArgs, reason: '继续读取后续搜索结果' }] : [] };
}
//# sourceMappingURL=boundedContentSearchPage.js.map