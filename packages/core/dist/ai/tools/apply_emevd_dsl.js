import { asNumber, asOptionalString, asRecord, asString, fail, finalizeEmevdDslApplyResult, nativePathFromFileToken, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import * as emevdEdit from '../../editing/emevdEdit.js';
/** apply_emevd_dsl: one domain tool declaration, schema and handler. */
export function createApplyEmevdDslTool() {
    return {
        name: 'apply_emevd_dsl',
        description: 'Compile and commit EMEVD DSL through the native Bridge four-view path. '
            + 'The source text goes in dsl; read_emevd_event returns the same text as darkScript, and darkScript is accepted as an alias for dsl. '
            + '完整文件模式 scope=file 可提交文件内 DSL；event-only 模式 scope=event 必须同时给出安全整数 eventId，核心只允许该事件作用域，禁止误删其他事件。'
            + ' event-scope 还必须回传最近一次完整 read_emevd_event 的 sourceHash、outerFileHash、sourceRevision 与 darkScriptComplete=true；读取必须是 offset=0 到 native total 的完整 darkscript 事件视图，底层会做 source identity CAS。JSON、tail、分页或缺少任一 identity 字段都不能写回。'
            + ' sourceRevision 是内容派生的修订号（同 sha256 恒定，不是 mtime），原样回传即可；write/rollback 改了 mtime 但字节没变时它仍然有效。'
            + ' 新建事件：目标 id 尚不存在时，显式传 createIfMissing=true（仍用 scope=event + eventId，dsl 必须是恰好一个 $Event(newId, ...) 块）。'
            + ' 新建不要求该事件的历史读取（它不存在，读不到）；改由 read_emevd_outline 的文件事件集证明 + sourceHash/outerFileHash/sourceRevision 回执授权。'
            + ' 事件集是分页交付的：证明按已送达页的并集成立，必须从 offset=0 按 hasMore/nextOffset 翻到 hasMore=false，只读一部分页会被 NATIVE_READ_COVERAGE_INCOMPLETE 拒绝（并点名缺哪些事件索引/页）。'
            + ' 新建模式对已存在的 eventId 直接返回 EMEVD_EVENT_ALREADY_EXISTS，绝不覆盖；反过来，省略 createIfMissing 时写不存在的 id 是 EMEVD_DSL_SCOPE_EVENT_NOT_FOUND，所以改已有事件不会因笔误变成新建。'
            + ' 写入后必须用 read_emevd_event 回读新事件确认，再决定下一步。'
            + ' The DSL is not a binary text patch; unknown/ambiguous parameter bindings and invalid scope inputs fail closed.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: {
            file: 'string',
            dsl: 'string?',
            darkScript: 'string?',
            mode: 'enum:patch|dark-script?',
            eventId: 'safe-integer?',
            scope: 'enum:file|event?',
            createIfMissing: 'boolean?',
            sourceHash: 'string?',
            outerFileHash: 'string?',
            sourceRevision: 'number?',
            darkScriptComplete: 'boolean?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.emedfPath !== undefined || value.emedfLocator !== undefined) {
                return fail('EMEVD_EXTERNAL_SCHEMA_FORBIDDEN', '生产 EMEVD 链不接受外部 EMEDF schema；请使用 SoulForge 内置 schema。');
            }
            const file = asString(value.file).trim();
            // read_emevd_event publishes the source as darkScript; applying that text back used to need
            // the same string under a different key (dsl), so the obvious round-trip failed on naming.
            // Accept either key, and refuse two different texts instead of silently preferring one.
            const dslText = asString(value.dsl);
            const darkScriptText = asString(value.darkScript);
            if (value.dsl !== undefined && value.darkScript !== undefined && dslText !== darkScriptText) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 同时收到 dsl 与 darkScript，且两者文本不同；dsl 是要提交的完整源文本，darkScript 只是同一字段的别名，请只传一个。');
            }
            const dsl = value.dsl !== undefined ? dslText : darkScriptText;
            if (!file || !dsl.trim())
                return fail('INVALID_INPUT', 'apply_emevd_dsl 需要 file 与非空 dsl（或 read_emevd_event 返回的同名文本 darkScript）。');
            const scope = value.scope === undefined ? 'file' : value.scope;
            const eventId = value.eventId;
            const safeEventId = typeof eventId === 'number' && Number.isSafeInteger(eventId) ? eventId : undefined;
            if (eventId !== undefined && safeEventId === undefined) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的 eventId 必须是安全整数。');
            }
            if (scope === 'event' && safeEventId === undefined) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的 scope=event 必须同时提供 eventId。');
            }
            if (scope === 'file' && safeEventId !== undefined) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的完整文件模式不能带 eventId；请使用 scope=event。');
            }
            if (value.createIfMissing !== undefined && typeof value.createIfMissing !== 'boolean') {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的 createIfMissing 必须是布尔值；它是显式新建意图，不能靠字符串或默认值推断。');
            }
            const createIfMissing = value.createIfMissing === true;
            if (createIfMissing && (scope !== 'event' || safeEventId === undefined)) {
                return fail('INVALID_INPUT', 'createIfMissing=true 只能与 scope=event + eventId 一起使用：新建必须点名目标事件 id。');
            }
            const sourceHash = asOptionalString(value.sourceHash);
            const outerFileHash = asOptionalString(value.outerFileHash);
            const sourceRevision = value.sourceRevision === undefined
                ? undefined
                : asNumber(value.sourceRevision, Number.NaN);
            const darkScriptComplete = value.darkScriptComplete === undefined
                ? undefined
                : typeof value.darkScriptComplete === 'boolean'
                    ? value.darkScriptComplete
                    : undefined;
            if (value.sourceHash !== undefined && sourceHash === undefined) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的 sourceHash 必须是非空字符串。');
            }
            if (value.outerFileHash !== undefined && outerFileHash === undefined) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的 outerFileHash 必须是非空字符串。');
            }
            if (value.darkScriptComplete !== undefined && darkScriptComplete === undefined) {
                return fail('INVALID_INPUT', 'apply_emevd_dsl 的 darkScriptComplete 必须是布尔值。');
            }
            if (createIfMissing) {
                // Creation cannot carry the per-event receipt (the event does not exist yet), so the
                // receipt is the file identity that a read_emevd_outline returns. darkScriptComplete
                // is meaningless here; an explicit false still means "this is a page" and is refused.
                const missing = [
                    sourceHash === undefined ? 'sourceHash' : null,
                    outerFileHash === undefined ? 'outerFileHash' : null,
                    sourceRevision === undefined || !Number.isFinite(sourceRevision) ? 'sourceRevision' : null,
                    darkScriptComplete === false ? 'darkScriptComplete 不为 false' : null
                ].filter((item) => item !== null);
                if (missing.length > 0) {
                    return fail('EMEVD_DSL_READ_RECEIPT_REQUIRED', `新建事件必须携带 read_emevd_outline 的 sourceHash、outerFileHash 与 sourceRevision，用来固定文件版本；当前缺少：${missing.join('、')}。请先在同一个 session 里 read_emevd_outline（读证明不跨进程/不跨 session 实例，另一个进程读的不算）翻到 hasMore=false，再把回执字段原样传回。`);
                }
            }
            else if (scope === 'event' && (sourceHash === undefined
                || outerFileHash === undefined
                || sourceRevision === undefined
                || !Number.isFinite(sourceRevision)
                || darkScriptComplete !== true)) {
                return fail('EMEVD_DSL_READ_RECEIPT_REQUIRED', `event-scope 写回必须携带最近一次完整 read_emevd_event 的 sourceHash、outerFileHash、sourceRevision 与 darkScriptComplete=true；当前缺少或不满足：${[
                    sourceHash === undefined ? 'sourceHash' : null,
                    outerFileHash === undefined ? 'outerFileHash' : null,
                    sourceRevision === undefined || !Number.isFinite(sourceRevision) ? 'sourceRevision' : null,
                    darkScriptComplete !== true ? 'darkScriptComplete=true' : null
                ].filter((item) => item !== null).join('、') || '完整 native DarkScript 视图'}。请先 read_emevd_event（format=darkscript，offset=0 读到末尾）再把回执字段原样传回。`);
            }
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const resolvedFile = context.hostResolvedEmevdEventTarget
                ? {
                    ok: true,
                    path: context.hostResolvedEmevdEventTarget.sourcePath,
                    sourceUri: context.hostResolvedEmevdEventTarget.sourceUri,
                    canonical: context.hostResolvedEmevdEventTarget.canonical
                }
                : resolveIndexedResourceFile(context, file, 'event');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const mode = value.mode === 'dark-script' ? 'dark-script' : 'patch';
            const applyInput = {
                edit: edit.session,
                file: context.hostResolvedEmevdEventTarget?.sourcePath
                    ?? nativePathFromFileToken(resolvedFile.path),
                dsl,
                mode,
                ...(safeEventId === undefined ? {} : { eventId: safeEventId }),
                ...(scope === 'event' && safeEventId !== undefined
                    ? { scope: { eventId: safeEventId } }
                    : {}),
                ...(createIfMissing ? { createIfMissing: true } : {}),
                ...(sourceHash ? { sourceHash } : {}),
                ...(outerFileHash ? { outerFileHash } : {}),
                ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                ...(darkScriptComplete !== undefined ? { darkScriptComplete } : {})
            };
            // A dangling param reference committed cleanly: ShootBullet with a Bullet row id in its
            // behaviorId argument succeeded exactly like the valid BehaviorParam row, so a wrong id could
            // only be caught by reading the result back and reasoning about tables. Refuse it before the
            // native write; a warning attached after the commit is too late to be a guarantee.
            const unresolvedReferences = [];
            if (context.workspaceIndex !== null) {
                const paramExports = (context.workspaceIndex.toSymbolBundle().params ?? []);
                const normalizeTable = (value) => value.replace(/[^a-z0-9]/giu, '').toLowerCase();
                const held = (names) => {
                    const wanted = names.map(normalizeTable);
                    // Native and catalog spellings differ (BEHAVIOR_PARAM_ST vs BehaviorParam_PC), so match by
                    // prefix instead of an exact list.
                    const matched = paramExports.filter((item) => {
                        const name = normalizeTable(item.paramName ?? '');
                        return wanted.some((alias) => name === alias || name.startsWith(alias));
                    });
                    return { known: matched.length > 0, ids: new Set(matched.flatMap((item) => (item.rows ?? []).map((row) => row.rowId))) };
                };
                const checks = [
                    { pattern: /ShootBullet\(\s*[^,()]+,\s*[^,()]+,\s*[^,()]+,\s*(-?\d+)/gu, argument: 'behaviorId', names: ['BehaviorParam', 'BehaviorParam_PC', 'BehaviorParam_Npc'] },
                    { pattern: /(?:Spawn|Delete)MapSFX\([^,()]+,\s*(-?\d+)/gu, argument: 'sfxId', names: ['SfxParam'] }
                ];
                for (const check of checks) {
                    const rows = held(check.names);
                    if (!rows.known)
                        continue;
                    for (const match of dsl.matchAll(check.pattern)) {
                        const value = Number(match[1]);
                        if (!Number.isSafeInteger(value) || value === 0)
                            continue;
                        if (rows.ids.has(value))
                            continue;
                        // Name the tables that do hold this id, so "wrong table" is distinguishable from
                        // "dangling reference" in the refusal itself.
                        const tablesHoldingId = [...new Set(paramExports
                                .filter((item) => (item.rows ?? []).some((row) => row.rowId === value))
                                .map((item) => item.paramName)
                                .filter((name) => typeof name === 'string' && name !== ''))];
                        unresolvedReferences.push({ instruction: match[0].split('(')[0].trim(), argument: check.argument, value, table: check.names[0], tablesHoldingId });
                    }
                }
            }
            if (unresolvedReferences.length > 0) {
                const details = unresolvedReferences.map((item) => item.instruction + '.' + item.argument + '=' + String(item.value));
                const first = unresolvedReferences[0];
                const owner = first.tablesHoldingId.length > 0
                    ? `该 id 在 ${first.tablesHoldingId.join(' / ')} 里有行，但那些不是 ${first.table} 行；`
                    : '这个 id 在索引里没有任何参数行，是悬空引用；';
                return fail('EMEVD_REFERENCE_UNRESOLVED', `${first.instruction} 的 ${first.argument}=${first.value} 不是 ${first.table} 行：${owner}`
                    + `行为引用参数必须指向 ${first.table} 的 rowId（不是 BULLET_PARAM_ST 等其它表的行）。`
                    + '先用 search_param_rows 按名称确认目标表与其 rowId，再提交。', { unresolvedReferences: details });
            }
            const result = await emevdEdit.applyEmevdDsl(applyInput);
            // 编辑层回吐物理绝对路径；回执面向模型，只给逻辑 sourceUri
            //（mutate_param_fields 同类问题已同法治）。
            const modelResult = (result.ok || result.transactionStatus === 'committed') && resolvedFile.ok
                ? {
                    ...result,
                    ...(typeof result.filePath === 'string'
                        ? { filePath: resolvedFile.sourceUri } : {}),
                    ...(result.committedPath !== undefined
                        ? { committedPath: resolvedFile.sourceUri } : {})
                }
                : result;
            return finalizeEmevdDslApplyResult(modelResult, file, context);
        }
    };
}
//# sourceMappingURL=apply_emevd_dsl.js.map