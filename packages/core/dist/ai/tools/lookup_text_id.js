import { asNumber, asOptionalString, asRecord, fail, ok } from '../toolRegistrySupport.js';
/** lookup_text_id: one domain tool declaration, schema and handler. */
export function createLookupTextIdTool() {
    return {
        name: 'lookup_text_id',
        description: 'Look up parsed text entries by numeric textId and optional category.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { textId: 'number', category: 'string?' },
        run: (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const textId = asNumber(value.textId, Number.NaN);
            if (!Number.isFinite(textId))
                return fail('INVALID_INPUT', 'lookup_text_id 需要数字 textId（先用 search_text_entries 查到条目）。');
            const category = asOptionalString(value.category);
            const matches = ws.lookupTextEntries(textId, category);
            if (matches.length === 0)
                return fail('TEXT_ENTRY_NOT_FOUND', `没有 id 为 ${textId} 的文本条目${category ? `（类别 ${category}）` : ''}。先用 search_text_entries 按内容搜索。`, { category });
            return ok({ textId, category, matches });
        }
    };
}
//# sourceMappingURL=lookup_text_id.js.map