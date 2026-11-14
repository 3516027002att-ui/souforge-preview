import { ALL_RESOURCE_KINDS } from '@soulforge/shared';
import { asRecord, asResourceKinds, fail, ok } from '../toolRegistrySupport.js';
/** search_resources: one domain tool declaration, schema and handler. */
export function createSearchResourcesTool() {
    return {
        name: 'search_resources',
        description: 'Search indexed workspace files by path, extension, or resource kind. Returns total and an opaque nextCursor; follow nextActions. Recovery/backup artifacts are excluded unless sourceFilter=all or artifacts is explicit.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { query: 'string?', limit: 'safe-integer?', kinds: `enum[]:${ALL_RESOURCE_KINDS.join('|')}?`, cursor: 'string?', sourceFilter: 'enum:active|all|artifacts?' },
        run: (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const kinds = asResourceKinds(value.kinds);
            try {
                const { items: _items, ...page } = ws.searchResourcesPage({
                    ...(typeof value.query === 'string' ? { query: value.query } : {}),
                    ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
                    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
                    ...(typeof value.sourceFilter === 'string' ? { sourceFilter: value.sourceFilter } : {}),
                    ...(kinds ? { kinds } : {})
                });
                // An empty page must say why it is empty: no query and no kind filter means the whole
                // index was listed, while a query that matched nothing is a different answer.
                const pageMatches = page.matches;
                const empty = Array.isArray(pageMatches) && pageMatches.length === 0;
                const note = !empty ? undefined
                    : (typeof value.query === 'string' && value.query.trim() !== '')
                        ? `索引里没有匹配「${value.query.trim().slice(0, 60)}」的资源；换更短的关键词，或去掉 kinds 过滤。`
                        : '索引里没有符合条件的资源；可去掉 kinds/sourceFilter 过滤后再试。';
                return ok(note ? { ...page, note } : page);
            }
            catch (error) {
                return fail(error.code ?? 'RESOURCE_SEARCH_FAILED', String(error));
            }
        }
    };
}
//# sourceMappingURL=search_resources.js.map