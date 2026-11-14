import { asRecord, asString, clipForMessage, fail, ok, requireEditSession } from '../toolRegistrySupport.js';
import * as emevdEdit from '../../editing/emevdEdit.js';
/** explain_event: one domain tool declaration, schema and handler. */
export function createExplainEventTool() {
    return {
        name: 'explain_event',
        description: 'Build an evidence-first explanation input for one event URI. '
            + 'uri accepts event://<mapId>/<eventId> (the form read_emevd_event returns as eventUri) '
            + 'or <sourceUri>#event/<eventId>.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: { uri: 'string' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const uri = asString(value.uri);
            if (!uri)
                return fail('INVALID_INPUT', 'explain_event 需要 uri（event://<mapId>/<eventId>，即 read_emevd_event 返回的 eventUri）。');
            const explanation = ws.buildEventExplanationInput(uri);
            if (explanation)
                return ok(explanation);
            // The persistent index can legitimately lag a live Bridge read (fresh
            // workspace, cache invalidation, or an event opened before background
            // indexing finished).  Fall back to the native outline, but label the
            // result partial: an outline contains counts/IDs, not decoded EMEDF args.
            if (!context.session)
                return fail('EVENT_NOT_FOUND', `该 URI 没有对应事件：${clipForMessage(uri)}。先用 search_events 或 read_emevd_outline 确认事件 id。`);
            const eventMatch = /#event\/(-?\d+)/.exec(uri);
            if (!eventMatch)
                return fail('EVENT_NOT_FOUND', `该 URI 没有对应事件：${clipForMessage(uri)}。先用 search_events 或 read_emevd_outline 确认事件 id。`);
            const sourceUri = uri.slice(0, uri.indexOf('#'));
            const indexedFile = ws.getFile(sourceUri);
            if (!indexedFile)
                return fail('EVENT_SOURCE_NOT_INDEXED', `事件来源尚未索引：${sourceUri}`);
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const outline = await emevdEdit.readEmevdOutline({ edit: edit.session, file: indexedFile.absolutePath });
            if (!outline.ok || !outline.events) {
                return fail(outline.error?.code ?? 'EMEVD_READ_FAILED', outline.error?.message ?? '无法从 Bridge 读取事件。');
            }
            const eventId = Number(eventMatch[1]);
            const row = outline.events.find((event) => event.eventId === eventId);
            if (!row)
                return fail('EVENT_NOT_FOUND', `Bridge 中没有事件 ${eventId}。`);
            const partialEvent = {
                uri,
                sourceUri,
                eventId,
                instructions: [],
                raw: {
                    authority: 'native-read-outline',
                    instructionCount: row.instructionCount,
                    restBehavior: row.restBehavior,
                    semanticArgsDecoded: false
                }
            };
            return ok({
                event: partialEvent,
                report: {
                    eventUri: uri,
                    eventId,
                    confirmed: [],
                    possible: [],
                    unknownArguments: [],
                    diagnostics: [
                        '仅取得 C# Bridge 原生事件 outline；EMEDF 指令参数尚未解码，不能推断实体、参数或文本引用。'
                    ]
                },
                markdown: `# Event ${eventId}\n\n- authority: native-read-outline\n- instructionCount: ${row.instructionCount}\n- restBehavior: ${row.restBehavior}\n- diagnostics: EMEDF 参数尚未解码，引用结论不可用。`,
                references: [],
                authority: 'partial-outline',
                diagnostics: outline.diagnostics
            });
        }
    };
}
//# sourceMappingURL=explain_event.js.map