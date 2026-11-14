import { asNumber, asOptionalString, asRecord, fail, ok, requireEditSession } from '../toolRegistrySupport.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { resolveDropChain } from '../../param/dropChain.js';
import { collectDropChainEmevdEvidence } from '../../param/dropChainEmevd.js';
import { loadWorkspaceEventInstructionIndex } from '../eventArgumentIndexService.js';
/**
 * `explain_drop_chain`: answer "does killing this NPC actually unlock anything" mechanically.
 *
 * The three tables involved (NpcParam.itemLotId_*, ItemLotParam.lotItemId0N, EquipParamGoods.isConsume)
 * are each readable, but nothing composed them: `find_references` on the goods row returns only text
 * relations, and a lot whose slots point at `isConsume=1` display props looks identical to a working
 * drop until a human compares all three. This tool is that comparison, with an explicit verdict.
 */
/** A page holds at most 128 cells; follow the cursor rather than silently reporting a partial chain. */
const MAX_READ_PAGES = 8;
function readFailure(error) {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    return wrapped;
}
function toFieldValue(field) {
    return {
        table: field.table,
        rowId: field.rowId,
        fieldId: field.fieldId,
        value: field.value,
        ...(field.rowName === undefined ? {} : { rowName: field.rowName })
    };
}
function mergeInto(target, source) {
    target.fields.push(...source.fields);
    target.missingRows.push(...source.missingRows);
    if (target.missingFields !== undefined || source.missingFields !== undefined) {
        target.missingFields ??= [];
        target.missingFields.push(...(source.missingFields ?? []));
    }
}
/**
 * Read one query, following the page cursor. Row-by-row retry mirrors read_param_fields: one unknown
 * id in a batch makes the native read report *every* row missing, which would turn a resolvable chain
 * into a false "broken".
 */
function createNativeDropChainReader(session, containerPath) {
    const readQuery = async (query) => {
        const merged = { fields: [], missingRows: [] };
        let cursor;
        for (let page = 0; page < MAX_READ_PAGES; page += 1) {
            const result = await readParamFields({
                edit: session,
                queries: [query],
                pageSize: 128,
                ...(cursor === undefined ? {} : { cursor }),
                ...(containerPath === undefined ? {} : { containerPath })
            });
            if (!result.ok) {
                if (result.error.code === 'PARAM_ROW_NOT_FOUND') {
                    if (query.rowIds.length <= 1) {
                        for (const rowId of query.rowIds)
                            merged.missingRows.push({ table: query.table, rowId });
                        return merged;
                    }
                    for (const rowId of query.rowIds) {
                        mergeInto(merged, await readQuery({ ...query, rowIds: [rowId] }));
                    }
                    return merged;
                }
                if (result.error.code === 'PARAM_FIELD_NOT_FOUND') {
                    // None of the requested fields exist on this table. Report it as a missing field
                    // rather than failing the chain: the row's existence is still worth keeping.
                    merged.missingFields = query.fieldIds.map((fieldId) => ({ table: query.table, fieldId, rowIds: [...query.rowIds] }));
                    return merged;
                }
                const error = readFailure(result.error.message);
                error.code = result.error.code;
                throw error;
            }
            merged.fields.push(...result.fields.map(toFieldValue));
            merged.missingRows.push(...result.missingRows.map((row) => ({ table: row.table, rowId: row.rowId })));
            if (result.missingFields !== undefined && result.missingFields.length > 0) {
                merged.missingFields ??= [];
                merged.missingFields.push(...result.missingFields.map((item) => ({
                    table: item.table, fieldId: item.fieldId, rowIds: [...item.rowIds]
                })));
            }
            const nextCursor = result.pagination?.nextCursor ?? null;
            if (result.pagination?.hasMore !== true || nextCursor === null)
                return merged;
            if (page === MAX_READ_PAGES - 1)
                merged.truncated = true;
            cursor = nextCursor;
        }
        return merged;
    };
    return async (queries) => {
        const merged = { fields: [], missingRows: [] };
        for (const query of queries) {
            mergeInto(merged, await readQuery(query));
        }
        return merged;
    };
}
/** The EMEVD join is keyed by the MSB `npcParamRowId`; only NpcParam rows can use it. */
function isNpcParamTable(table) {
    if (table === undefined || table.trim() === '')
        return true;
    const token = table.replaceAll('_', '').replaceAll(' ', '').toLocaleLowerCase();
    return token === 'npcparam' || token === 'npcparamst';
}
/** explain_drop_chain: one domain tool declaration, schema and handler. */
export function createExplainDropChainTool() {
    return {
        name: 'explain_drop_chain',
        description: 'Resolve an item drop chain end to end and return one explicit verdict. '
            + 'Two paths are checked for a NpcParam row: (1) NpcParam.itemLotId_1..8 -> ItemLotParam.lotItemIdNN '
            + '(+lotItemCategoryNN) -> EquipParamGoods.isConsume; (2) the EMEVD path Sekiro actually uses: '
            + 'MSB npcParamRowId -> entityId -> events that reference that instance -> AwardItemLot(itemLotId) -> '
            + 'the same ItemLotParam chain. Boss NpcParam rows keep itemLotId_* at -1 while ordinary enemies use the '
            + 'param path (NpcParam#10100000.itemLotId_1=10100000), so for a boss the second path is usually the only one. verdict=unlocks means the chain tail is a real item (isConsume=0); display-only '
            + 'means every resolvable slot rolls an isConsume=1 display prop (shown in the acquisition banner and '
            + 'deleted); not-applicable means both paths were checked completely and no item-lot reference exists '
            + '(ordinary NPC, or the NPC is handled by an EMEVD defeat handler without AwardItemLot); inconclusive '
            + 'means a path could not be checked completely (event index unread/undecoded, no map instance, or an '
            + 'AwardItemLot id passed as a common-event parameter); broken means a drop reference exists (param lot '
            + 'or EMEVD AwardItemLot) but the chain does not close (missing ItemLotParam row, missing item row, '
            + 'unknown category, or an empty lot). The answer names both paths and every hop with row ids, row names, '
            + 'isConsume and the event URI, plus `breaks` naming the exact failing hop and `paths` stating which path '
            + 'was checked. Use it for "打死它到底解锁了什么" before editing NpcParam/ItemLotParam. Start from the drop '
            + 'source with table+rowId (default table=NpcParam), or from a lot id directly (itemLotId, e.g. the id an '
            + 'EMEVD AwardItemLot argument carries). This is not a reverse index: to ask "who drops goods X", pass the '
            + 'lot id you found rather than the goods id. Read-only. First call builds the workspace EMEVD instruction '
            + 'index (47 files) and is cached afterwards.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string?',
            rowId: 'safe-integer?',
            itemLotId: 'safe-integer?',
            containerPath: 'string?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            const table = asOptionalString(value.table)?.trim();
            const rowId = Number.isSafeInteger(value.rowId) ? Math.trunc(asNumber(value.rowId, Number.NaN)) : undefined;
            const itemLotId = Number.isSafeInteger(value.itemLotId) ? Math.trunc(asNumber(value.itemLotId, Number.NaN)) : undefined;
            if ((rowId === undefined || Number.isNaN(rowId)) && (itemLotId === undefined || Number.isNaN(itemLotId))) {
                return fail('DROP_CHAIN_TARGET_REQUIRED', 'explain_drop_chain 需要 table + rowId（例如 {"table":"NpcParam","rowId":50800000}），或直接给 itemLotId。');
            }
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const containerPath = asOptionalString(value.containerPath);
            const read = createNativeDropChainReader(edit.session, containerPath);
            // The param path alone cannot answer for a boss: a boss row keeps itemLotId_* at -1 and the
            // item comes from AwardItemLot in the kill event. Build that join before deciding "broken".
            // A direct itemLotId trace and a non-NpcParam row keep the legacy param-only behaviour.
            let emevevd;
            let emevevdUnavailableReason;
            if (rowId !== undefined && !Number.isNaN(rowId) && itemLotId === undefined && isNpcParamTable(table)) {
                const ws = context.workspaceIndex;
                if (ws === null) {
                    emevevd = null;
                    emevevdUnavailableReason = '没有打开 Mod 工作区索引，无法读取该 NPC 关联的 EMEVD 事件；EMEVD 路径没有检查。';
                }
                else {
                    try {
                        const loaded = await loadWorkspaceEventInstructionIndex({
                            workspaceId: ws.workspaceId,
                            ws,
                            edit: edit.session,
                            ...(context.signal ? { signal: context.signal } : {})
                        });
                        if (!loaded.ok) {
                            emevevd = null;
                            emevevdUnavailableReason = `${loaded.code}: ${loaded.message}`;
                        }
                        else {
                            emevevd = collectDropChainEmevdEvidence({
                                rowId,
                                ...(table === undefined || table === '' ? {} : { table }),
                                bundle: ws.toSymbolBundle(),
                                index: loaded.index
                            });
                        }
                    }
                    catch (error) {
                        // A missing event index must not become "verified absent": hand the resolver a
                        // null path so it returns inconclusive rather than broken.
                        emevevd = null;
                        emevevdUnavailableReason = `EMEVD 事件索引读取失败：${error instanceof Error ? error.message : String(error)}`;
                    }
                }
            }
            try {
                const resolution = await resolveDropChain({
                    ...(table === undefined || table === '' ? {} : { table }),
                    ...(rowId === undefined || Number.isNaN(rowId) ? {} : { rowId }),
                    ...(itemLotId === undefined || Number.isNaN(itemLotId) ? {} : { itemLotId }),
                    ...(emevevd === undefined ? {} : { emevevd }),
                    ...(emevevdUnavailableReason === undefined ? {} : { emevevdUnavailableReason }),
                    read
                });
                if (!resolution.ok)
                    return fail(resolution.code, resolution.message, resolution.details);
                return ok(resolution.result);
            }
            catch (error) {
                const code = typeof error.code === 'string'
                    ? error.code : 'DROP_CHAIN_READ_FAILED';
                return fail(code, error instanceof Error ? error.message : '掉落链读取失败。');
            }
        }
    };
}
//# sourceMappingURL=explain_drop_chain.js.map