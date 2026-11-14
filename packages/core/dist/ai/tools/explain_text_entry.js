import { asNumber, asOptionalString, asRecord, fail, ok } from '../toolRegistrySupport.js';
import { buildTextAiContext, renderTextAiPrompt } from '.././aiContextBuilder.js';
/** explain_text_entry: one domain tool declaration, schema and handler. */
export function createExplainTextEntryTool() {
    return {
        name: 'explain_text_entry',
        description: 'Build evidence-first AI explanation contexts for a parsed textId.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: {
            textId: 'number',
            category: 'string?',
            maxReferences: 'number?',
            maxMarkdownChars: 'number?'
        },
        run: (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const textId = asNumber(value.textId, Number.NaN);
            if (!Number.isFinite(textId))
                return fail('INVALID_INPUT', 'explain_text_entry 需要数字 textId（先用 search_text_entries 查到条目）。');
            const category = asOptionalString(value.category);
            const maxReferences = asNumber(value.maxReferences, 80);
            const maxMarkdownChars = asNumber(value.maxMarkdownChars, 24000);
            const matches = ws.lookupTextEntries(textId, category);
            if (matches.length === 0)
                return fail('TEXT_ENTRY_NOT_FOUND', `没有 id 为 ${textId} 的文本条目${category ? `（类别 ${category}）` : ''}。先用 search_text_entries 按内容搜索。`, { category });
            const contexts = matches.map((entry) => {
                const references = ws.findReferences(entry.uri, 'to');
                const aiContext = buildTextAiContext(entry, references, { maxReferences, maxMarkdownChars });
                return { context: aiContext, prompt: renderTextAiPrompt(aiContext) };
            });
            return ok({ textId, category, contexts });
        }
    };
}
//# sourceMappingURL=explain_text_entry.js.map