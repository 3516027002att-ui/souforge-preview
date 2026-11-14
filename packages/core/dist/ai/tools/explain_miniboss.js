import { asNumber, asOptionalString, asRecord, fail, ok, requireEditSession } from '../toolRegistrySupport.js';
import { loadWorkspaceEventInstructionIndex } from '../eventArgumentIndexService.js';
import { explainMiniboss } from '../../references/minibossEvidence.js';
/**
 * explain_miniboss: 机械回答“这个 NpcParam 行是不是 miniboss，证据是哪条事件”。
 *
 * 数据不在 NpcParam 里（`npcType` 只有 0=普通敌对 / 1=Boss / 2=友好·中立 三档，
 * 精英没有独立档位、与杂兵同为 0；`teamType`/`spEffectID0` 对精英和杂兵也同值），
 * 而在 EMEVD 的实体参数上：`DisplayMinibossHealthBar(entityId, disabledEnabled=0)`
 * 与 `HandleMinibossDefeat(entityId)`。工具把 NpcParam 行 → 地图 part
 * （原生 `npcParamRowId` 外键）→ `entityId` → 事件指令串起来，并给出覆盖率。
 * 没有证据且覆盖完整时才返回 `no-evidence`；否则返回 `inconclusive`。
 */
export function createExplainMinibossTool() {
    return {
        name: 'explain_miniboss',
        description: 'Decide mechanically whether an NpcParam row is a miniboss, with EMEVD evidence. '
            + 'Resolves NpcParam rowId -> map part (native npcParamRowId) -> entityId -> event instructions, '
            + 'and reports evidence such as DisplayMinibossHealthBar(disabledEnabled=0, entityId=...) and '
            + 'HandleMinibossDefeat(entityId) from the workspace event index. '
            + 'Verdict is miniboss when literal evidence exists; no-evidence only when every event file was read '
            + 'and the maps are covered; otherwise inconclusive with blockedReasons. '
            + 'Entity args that come from common event parameters (X<offset>_<width>) cannot be attributed to any entity, '
            + 'so they prove nothing by themselves. If such unattributable instructions in the row\'s own map include a '
            + 'health-bar instruction name (DisplayMinibossHealthBar / HandleMinibossDefeat / DisplayBossHealthBar), one of them '
            + 'may target this row\'s instance: the verdict is inconclusive, isMiniboss=null, negativeConclusionAllowed=false, '
            + 'and blockedReasons carries EVENT_INDEX_PARAMETERIZED_BLOOD_BAR_INSTRUCTIONS with the count. '
            + 'If the unattributable instructions contain no health-bar name, they are irrelevant to this judgement: the negative '
            + 'verdict still stands, negativeConclusionAllowed stays true, and a caveat says why. coverage.parameterizedEntityArgs, '
            + 'coverage.parameterizedBloodBarInstructions and coverage.parameterizedBlocksNegative spell out which case applied. '
            + 'NpcParam fields themselves cannot prove this: npcType only separates 0=hostile / 1=boss / 2=friendly-neutral, '
            + 'and elites have no separate value (they read 0 like normal enemies); teamType/spEffectID0 are identical for elites and normal enemies.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: {
            npcParamRowId: 'safe-integer',
            table: 'string?',
            maxEvidence: 'number?'
        },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const rowId = asNumber(value.npcParamRowId, Number.NaN);
            if (!Number.isSafeInteger(rowId) || rowId <= 0) {
                return fail('INVALID_INPUT', 'explain_miniboss 需要安全正整数 npcParamRowId。');
            }
            const table = asOptionalString(value.table)?.trim() || 'NpcParam';
            const maxEvidence = value.maxEvidence === undefined ? 100 : asNumber(value.maxEvidence, 100);
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const loaded = await loadWorkspaceEventInstructionIndex({
                workspaceId: ws.workspaceId,
                ws,
                edit: edit.session,
                ...(context.signal ? { signal: context.signal } : {})
            });
            if (!loaded.ok) {
                return fail(loaded.code, loaded.message, loaded.diagnostics);
            }
            const answer = explainMiniboss({
                npcParamRowId: rowId,
                table,
                bundle: ws.toSymbolBundle(),
                index: loaded.index,
                maxEvidence
            });
            return ok({
                ...answer,
                query: { npcParamRowId: rowId, table },
                indexCoverage: {
                    filesDiscovered: loaded.index.coverage.filesDiscovered,
                    filesRead: loaded.index.coverage.filesRead,
                    filesFailed: loaded.index.coverage.filesFailed,
                    eventsScanned: loaded.index.coverage.eventsScanned,
                    instructionsScanned: loaded.index.coverage.instructionsScanned,
                    buildMs: loaded.index.buildMs,
                    status: loaded.index.coverage.status
                },
                nextActions: answer.evidence.length > 0
                    ? [{ tool: 'read_emevd_event', args: { file: answer.evidence[0].sourceUri, eventId: answer.evidence[0].eventId, format: 'json' }, reason: '按返回的事件身份读取原生指令，核对证据原文。' }]
                    : []
            });
        }
    };
}
//# sourceMappingURL=explain_miniboss.js.map