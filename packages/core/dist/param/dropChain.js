/** Sekiro NpcParam slot fields. The schema ships itemLotId_1..6; 7/8 are probed for future-proofing. */
export const DROP_CHAIN_NPC_LOT_FIELD_IDS = [
    'itemLotId_1', 'itemLotId_2', 'itemLotId_3', 'itemLotId_4', 'itemLotId_5', 'itemLotId_6', 'itemLotId_7', 'itemLotId_8'
];
/**
 * ITEMLOT_PARAM_ST v2 carries eight item slots. Slots are discovered by field-id pattern rather than
 * assumed to exist, so a schema with fewer (or more) slots reports what it actually has.
 */
export const DROP_CHAIN_LOT_SLOT_FIELD_IDS = [
    ...Array.from({ length: 8 }, (_, index) => `lotItemId${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 8 }, (_, index) => `lotItemCategory${String(index + 1).padStart(2, '0')}`),
    ...Array.from({ length: 8 }, (_, index) => `lotItemNum${String(index + 1).padStart(2, '0')}`)
];
/**
 * `lotItemCategoryNN` selects the target table; the values come from the first-party schema `refs` of
 * lotItemId01..08 (`EquipParamGoods(lotItemCategory01=1073741824)` etc.).
 */
export const DROP_CHAIN_CATEGORY_TABLES = {
    0: 'EquipParamWeapon',
    268435456: 'EquipParamProtector',
    1073741824: 'EquipParamGoods'
};
/** -1 (and 0) both mean "no lot referenced"; Sekiro mods use either in empty slots. */
function isUnsetId(value) {
    return !Number.isFinite(value) || value <= 0;
}
function numberValue(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'boolean')
        return value ? 1 : 0;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return null;
}
function quoteName(rowName) {
    return rowName === undefined || rowName === '' ? '' : `「${rowName}」`;
}
function rowLabel(table, rowId, rowName) {
    return `${table}#${rowId}${quoteName(rowName)}`;
}
/**
 * Row identity for cross-read joins. The native read may answer with the logical alias a caller asked
 * for or with the physical child name (`EquipParamGoods` vs `EQUIP_PARAM_GOODS_ST`), so the join key is
 * normalized instead of relying on one spelling.
 */
function targetKey(table, rowId) {
    return `${table.replaceAll('_', '').toLowerCase()}\u0000${rowId}`;
}
function groupByRow(fields) {
    const rows = new Map();
    for (const field of fields) {
        const key = targetKey(field.table, field.rowId);
        const bucket = rows.get(key) ?? { values: new Map() };
        if (bucket.rowName === undefined && field.rowName !== undefined)
            bucket.rowName = field.rowName;
        bucket.values.set(field.fieldId, field.value);
        rows.set(key, bucket);
    }
    return rows;
}
function slotSuffix(fieldId, prefix) {
    if (!fieldId.startsWith(prefix))
        return undefined;
    const suffix = fieldId.slice(prefix.length);
    return /^\d+$/u.test(suffix) ? suffix : undefined;
}
function pushUniqueTarget(list, target) {
    if (list.some((item) => targetKey(item.table, item.rowId) === targetKey(target.table, target.rowId)))
        return;
    list.push(target);
}
/**
 * Read the lot rows, then the rows their slots point at, then decide.
 *
 * The verdict stays deliberately coarse (three states) while `breaks` stays specific: a caller needs
 * one word to answer "does this unlock anything", and the exact hop when the answer is no.
 */
export async function resolveDropChain(input) {
    const diagnostics = [];
    const breaks = [];
    let start;
    if (input.itemLotId !== undefined) {
        if (isUnsetId(input.itemLotId)) {
            return { ok: false, code: 'DROP_CHAIN_ITEM_LOT_INVALID', message: `itemLotId 必须是大于 0 的行号，收到 ${input.itemLotId}。` };
        }
        start = { kind: 'item-lot', itemLotId: input.itemLotId };
    }
    else {
        const table = (input.table ?? 'NpcParam').trim();
        if (table === '') {
            return { ok: false, code: 'DROP_CHAIN_TARGET_REQUIRED', message: 'explain_drop_chain 需要 table + rowId（例如 NpcParam#50800000），或直接给 itemLotId。' };
        }
        if (input.rowId === undefined || !Number.isSafeInteger(input.rowId)) {
            return { ok: false, code: 'DROP_CHAIN_TARGET_REQUIRED', message: 'explain_drop_chain 需要 table + rowId（例如 NpcParam#50800000），或直接给 itemLotId。' };
        }
        const rowId = input.rowId;
        const startRead = await input.read([{ table, rowIds: [rowId], fieldIds: [...DROP_CHAIN_NPC_LOT_FIELD_IDS] }]);
        if (startRead.truncated === true)
            diagnostics.push('起始行的原生读取在页上限处停止，itemLotId_* 可能不完整。');
        if (startRead.missingRows.some((row) => row.rowId === rowId && targetKey(row.table, rowId) === targetKey(table, rowId))) {
            return {
                ok: false,
                code: 'DROP_CHAIN_START_ROW_MISSING',
                message: `${table}#${rowId} 不存在；先用 search_param_rows 或 read_param_fields 确认掉落来源行。`
            };
        }
        const startFields = startRead.fields.filter((field) => field.rowId === rowId && DROP_CHAIN_NPC_LOT_FIELD_IDS.includes(field.fieldId));
        if (startFields.length === 0) {
            return {
                ok: false,
                code: 'DROP_CHAIN_START_NOT_A_DROP_SOURCE',
                message: `${table}#${rowId} 没有任何 itemLotId_* 字段，它不是掉落来源。请传掉落来源行（如 table:"NpcParam"），或直接给 itemLotId（例如从 EMEVD AwardItemLot 读到的 90017000）。`
            };
        }
        const itemLotIdFields = startFields
            .map((field) => ({ fieldId: field.fieldId, value: numberValue(field.value) ?? -1 }))
            .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
            .map((field) => ({ ...field, state: isUnsetId(field.value) ? 'unset' : 'set' }));
        start = {
            kind: 'npc-param',
            table,
            rowId,
            ...(startFields[0]?.rowName === undefined ? {} : { rowName: startFields[0].rowName }),
            itemLotIdFields
        };
    }
    const paramLotIds = start.kind === 'item-lot'
        ? []
        : [...new Set((start.itemLotIdFields ?? []).filter((field) => field.state === 'set').map((field) => field.value))];
    const emevevdEvidence = input.emevevd === undefined || input.emevevd === null ? undefined : input.emevevd;
    const awardLotIds = start.kind === 'item-lot'
        ? []
        : [...new Set((emevevdEvidence?.awards ?? []).map((award) => award.itemLotId))];
    const lotIds = start.kind === 'item-lot'
        ? [start.itemLotId]
        : [...new Set([...paramLotIds, ...awardLotIds])].sort((left, right) => left - right);
    if (emevevdEvidence !== undefined) {
        start.emevevd = {
            instanceCount: emevevdEvidence.instances.length,
            entityIds: emevevdEvidence.entityIds,
            candidateEventCount: emevevdEvidence.candidateEvents.length,
            candidateEvents: emevevdEvidence.candidateEvents.map((event) => ({
                eventUri: event.eventUri,
                sourceUri: event.sourceUri,
                eventId: event.eventId,
                entityIds: event.entityIds
            })),
            awards: emevevdEvidence.awards.map((award) => ({
                itemLotId: award.itemLotId,
                eventUri: award.eventUri,
                sourceUri: award.sourceUri,
                eventId: award.eventId,
                instructionIndex: award.instructionIndex,
                instructionName: award.instructionName,
                statement: award.statement
            })),
            unresolvedAwardCount: emevevdEvidence.unresolvedAwards.length,
            unresolvedAwards: emevevdEvidence.unresolvedAwards.map((award) => ({
                eventUri: award.eventUri,
                instructionIndex: award.instructionIndex,
                statement: award.statement
            })),
            unassociatedAwardCount: emevevdEvidence.unassociatedAwards.length,
            unassociatedAwards: emevevdEvidence.unassociatedAwards.map((award) => ({
                itemLotId: award.itemLotId,
                eventUri: award.eventUri,
                instructionIndex: award.instructionIndex,
                statement: award.statement
            })),
            handlers: emevevdEvidence.handlers.map((handler) => ({
                eventUri: handler.eventUri,
                eventId: handler.eventId,
                instructionIndex: handler.instructionIndex,
                instructionName: handler.instructionName,
                statement: handler.statement
            })),
            coverage: emevevdEvidence.coverage,
            notes: emevevdEvidence.notes
        };
        diagnostics.push(...emevevdEvidence.notes);
    }
    else if (input.emevevd === null && input.emevevdUnavailableReason !== undefined) {
        diagnostics.push(input.emevevdUnavailableReason);
    }
    const startLabel = start.kind === 'item-lot'
        ? rowLabel('ItemLotParam', start.itemLotId)
        : rowLabel(start.table ?? 'NpcParam', start.rowId ?? 0, start.rowName);
    const emevevdPath = input.emevevd === undefined
        ? { checked: false, state: 'none', detail: '调用方没有请求 EMEVD 路径（只走了 NpcParam.itemLotId_* / 直接 itemLotId）。' }
        : input.emevevd === null
            ? {
                checked: false,
                state: 'unavailable',
                detail: input.emevevdUnavailableReason ?? '工作区事件索引不可用，EMEVD 路径没有检查。'
            }
            : {
                checked: true,
                state: input.emevevd.coverage.complete === false
                    ? 'inconclusive'
                    : input.emevevd.awards.length > 0
                        ? 'found'
                        : input.emevevd.unresolvedAwards.length > 0 || input.emevevd.unassociatedAwards.length > 0
                            ? 'inconclusive'
                            : 'none',
                detail: `${input.emevevd.instances.length} 个地图实例、${input.emevevd.candidateEvents.length} 个引用事件、`
                    + `${input.emevevd.awards.length} 条击杀事件 AwardItemLot、${input.emevevd.unassociatedAwards.length} 条非击败事件 AwardItemLot、`
                    + `${input.emevevd.unresolvedAwards.length} 条参数化 AwardItemLot、`
                    + `${input.emevevd.handlers.length} 条击败处理器；相关事件文件 ${input.emevevd.coverage.filesRead}/${input.emevevd.coverage.filesDiscovered} 可读。`
            };
    const paramPath = {
        checked: start.kind !== 'item-lot',
        state: paramLotIds.length > 0 ? 'found' : start.kind === 'item-lot' ? 'none' : 'none',
        detail: start.kind === 'item-lot'
            ? '调用方直接给了 itemLotId，没有走 NpcParam 路径。'
            : paramLotIds.length > 0
                ? `NpcParam.itemLotId_* 有 ${paramLotIds.length} 个引用：${paramLotIds.join(', ')}。`
                : `${startLabel}的 ${start.itemLotIdFields?.length ?? 0} 个 itemLotId_* 全部没有引用。`
    };
    const paths = { param: paramPath, emevevd: emevevdPath };
    if (lotIds.length === 0) {
        const unsetFields = (start.itemLotIdFields ?? []).map((field) => `${field.fieldId}=${field.value}`).join(', ');
        const fieldCount = start.itemLotIdFields?.length ?? 0;
        const paramText = `${startLabel}的 ${fieldCount} 个 itemLotId_* 全是 -1（${unsetFields}）`;
        let verdict;
        let code;
        let reason;
        if (input.emevevd === undefined) {
            verdict = 'broken';
            code = 'ITEM_LOT_ID_UNSET';
            reason = `${paramText}：击杀不会掷出任何掉落。调用方没有请求 EMEVD 路径，这条结论只覆盖 param 链。`;
        }
        else if (input.emevevd === null) {
            verdict = 'inconclusive';
            code = 'EMEVD_PATH_UNAVAILABLE';
            reason = `${paramText}；EMEVD 路径不可用（${input.emevevdUnavailableReason ?? '没有工作区事件索引'}），不能断言该 NPC 没有掉落。`;
        }
        else {
            const evidence = input.emevevd;
            const eventText = `EMEVD 侧查了 ${evidence.instances.length} 个地图实例、${evidence.candidateEvents.length} 个引用事件，`
                + `找到 ${evidence.awards.length} 条击杀事件 AwardItemLot、${evidence.unassociatedAwards.length} 条非击败事件 AwardItemLot、`
                + `${evidence.unresolvedAwards.length} 条参数化 AwardItemLot、${evidence.handlers.length} 条击败处理器`;
            const handlerLabels = [...new Set(evidence.handlers.map((handler) => `${handler.eventUri} 的 ${handler.instructionName}`))];
            if (!evidence.coverage.complete) {
                verdict = 'inconclusive';
                code = 'EMEVD_COVERAGE_INCOMPLETE';
                reason = `${paramText}；${eventText}。相关事件文件只读出 ${evidence.coverage.filesRead}/${evidence.coverage.filesDiscovered}，`
                    + `未知指令 ${evidence.coverage.unknownInstructions}、解码失败 ${evidence.coverage.decodeFailures}：两条路都查过，但 EMEVD 侧不完整，不能断言没有掉落。`;
            }
            else if (evidence.instances.length === 0) {
                verdict = 'inconclusive';
                code = 'NPC_NOT_PLACED_IN_MAP';
                reason = `${paramText}；这张 NpcParam 行在已索引地图里没有实例（MSB npcParamRowId 未命中），无法把 EMEVD 事件归到它：两条路都查过，但缺少关联键，不能断言没有掉落。`;
            }
            else if (evidence.unresolvedAwards.length > 0) {
                verdict = 'inconclusive';
                code = 'AWARD_ITEM_LOT_PARAMETERIZED';
                reason = `${paramText}；${eventText}。其中 ${evidence.unresolvedAwards[0].eventUri} 的 AwardItemLot 用公共事件形参传 itemLotId，`
                    + `无法从 EMEVD 字面量读出 id：两条路都查过，但不能断言没有掉落。`;
            }
            else if (evidence.unassociatedAwards.length > 0) {
                verdict = 'inconclusive';
                code = 'AWARD_EVENT_NOT_A_DEFEAT_EVENT';
                reason = `${paramText}；${eventText}。其中 ${evidence.unassociatedAwards[0].eventUri} 的 `
                    + `AwardItemLot#${evidence.unassociatedAwards[0].instructionIndex} 引用了该实体，但同一事件没有死亡/击败条件，`
                    + '无法证明它是击杀奖励：两条路都查过，但不能据此断言没有掉落。';
            }
            else if (evidence.handlers.length > 0) {
                verdict = 'not-applicable';
                code = 'EMEVD_DEFEAT_HANDLER_WITHOUT_LOT_AWARD';
                reason = `${paramText}；${eventText}。其中 ${handlerLabels.slice(0, 3).join('、')}`
                    + `${handlerLabels.length > 3 ? ` 等 ${handlerLabels.length} 处` : ''}，但没有 AwardItemLot：`
                    + '该 NPC 的击败由 EMEVD 处理器处理，不是 ItemLotParam 掉落链（两条路都查过）。';
            }
            else {
                verdict = 'not-applicable';
                code = 'NO_DROP_SOURCE';
                reason = `${paramText}；${eventText}，没有 AwardItemLot，也没有击败处理器：这是没有固定掉落的 NPC（两条路都查过）。`;
            }
        }
        breaks.push({
            code,
            severity: verdict === 'broken' ? 'error' : 'warning',
            hop: `${startLabel}.itemLotId_* + EMEVD`,
            message: reason
        });
        return {
            ok: true,
            result: {
                verdict,
                answer: `${reason}（${verdict}: ${code}）`,
                start,
                lots: [],
                unlocks: [],
                displayOnly: [],
                breaks,
                diagnostics,
                paths
            }
        };
    }
    const lotRead = await input.read([{ table: 'ItemLotParam', rowIds: lotIds, fieldIds: [...DROP_CHAIN_LOT_SLOT_FIELD_IDS] }]);
    if (lotRead.truncated === true)
        diagnostics.push('ItemLotParam 的原生读取在页上限处停止，槽位可能不完整。');
    const lotRows = groupByRow(lotRead.fields);
    const lots = [];
    const slotTargets = [];
    for (const itemLotId of lotIds) {
        const bucket = lotRows.get(targetKey('ItemLotParam', itemLotId));
        const lot = {
            itemLotId,
            ...(bucket?.rowName === undefined ? {} : { rowName: bucket.rowName }),
            found: bucket !== undefined,
            slots: [],
            emptySlotCount: 0
        };
        if (bucket === undefined) {
            const award = (start.emevevd?.awards ?? []).find((entry) => entry.itemLotId === itemLotId);
            const awardText = award === undefined
                ? ''
                : `（EMEVD ${award.eventUri} 的 AwardItemLot#${award.instructionIndex}）`;
            // A lot traced on its own has no upstream row to name, so the break must not pretend another
            // row referenced it (the first version printed "ItemLotParam#X → ItemLotParam#X").
            breaks.push(start.kind === 'item-lot'
                ? {
                    code: 'ITEM_LOT_ROW_MISSING',
                    severity: 'error',
                    hop: `ItemLotParam#${itemLotId}`,
                    message: `ItemLotParam#${itemLotId} 不存在：这个 itemLotId 没有对应行，掷不出也没有东西可解锁。`
                }
                : {
                    code: 'ITEM_LOT_ROW_MISSING',
                    severity: 'error',
                    hop: `${startLabel}${awardText} → ItemLotParam#${itemLotId}`,
                    message: `${startLabel}${awardText} 引用了 ItemLotParam#${itemLotId}，但该行不存在：掉落链在这里就断了。`
                });
            lots.push(lot);
            continue;
        }
        const suffixes = new Set();
        for (const fieldId of bucket.values.keys()) {
            const suffix = slotSuffix(fieldId, 'lotItemId');
            if (suffix !== undefined)
                suffixes.add(suffix);
        }
        for (const suffix of [...suffixes].sort()) {
            const itemId = numberValue(bucket.values.get(`lotItemId${suffix}`) ?? null);
            if (itemId === null || isUnsetId(itemId)) {
                lot.emptySlotCount += 1;
                continue;
            }
            const category = numberValue(bucket.values.get(`lotItemCategory${suffix}`) ?? null);
            const count = numberValue(bucket.values.get(`lotItemNum${suffix}`) ?? null);
            const targetTable = category === null ? undefined : DROP_CHAIN_CATEGORY_TABLES[category];
            const slot = {
                slot: suffix,
                itemIdFieldId: `lotItemId${suffix}`,
                itemId,
                count,
                category,
                targetTable: targetTable ?? null,
                state: 'unverified'
            };
            if (targetTable === undefined) {
                slot.state = 'unknown-category';
                breaks.push({
                    code: 'LOT_SLOT_UNKNOWN_CATEGORY',
                    severity: 'error',
                    hop: `ItemLotParam#${itemLotId}.lotItemCategory${suffix}=${category ?? 'null'}`,
                    message: `ItemLotParam#${itemLotId} 的 slot${suffix} 指向 ${itemId}，但 lotItemCategory${suffix}=${category ?? 'null'} 不是已知类别（0=Weapon / 268435456=Protector / 1073741824=Goods），无法确定目标表。`
                });
            }
            lot.slots.push(slot);
            if (targetTable !== undefined)
                slotTargets.push({ lot, slot });
        }
        if (lot.slots.length === 0) {
            breaks.push({
                code: 'LOT_SLOT_EMPTY',
                severity: 'error',
                hop: `ItemLotParam#${itemLotId}.lotItemId01..08`,
                message: `ItemLotParam#${itemLotId} 存在，但所有槽位都是 0/-1：这个 lot 掷不出任何东西。`
            });
        }
        lots.push(lot);
    }
    // One read per target table: `isConsume` only exists on EquipParamGoods, and asking another table
    // for it fails the whole native read (PARAM_FIELD_NOT_FOUND), which would erase the row's existence.
    const targetsByTable = new Map();
    for (const { slot } of slotTargets) {
        if (slot.targetTable === null)
            continue;
        const rowIds = targetsByTable.get(slot.targetTable) ?? [];
        if (!rowIds.includes(slot.itemId))
            rowIds.push(slot.itemId);
        targetsByTable.set(slot.targetTable, rowIds);
    }
    const targetRows = new Map();
    const missingTargets = new Set();
    for (const [table, rowIds] of targetsByTable) {
        const read = await input.read([{ table, rowIds, fieldIds: table === 'EquipParamGoods' ? ['isConsume'] : [] }]);
        if (read.truncated === true)
            diagnostics.push(`${table} 的原生读取在页上限处停止，链尾可能不完整。`);
        if (read.missingFields !== undefined && read.missingFields.length > 0) {
            diagnostics.push(`${table} 的目标行没有交付请求字段：${read.missingFields.map((item) => item.fieldId).join(', ')}。`);
        }
        for (const [key, value] of groupByRow(read.fields))
            targetRows.set(key, value);
        // Table spelling is the native child name (`EquipParamGoods`) or its type (`EQUIP_PARAM_GOODS_ST`),
        // so a missing-row entry may not match the slot's table string byte for byte.
        for (const row of read.missingRows)
            missingTargets.add(targetKey(row.table, row.rowId));
    }
    const unlocks = [];
    const displayOnly = [];
    for (const { lot, slot } of slotTargets) {
        if (slot.targetTable === null)
            continue;
        const bucket = targetRows.get(targetKey(slot.targetTable, slot.itemId));
        const rowMissing = missingTargets.has(targetKey(slot.targetTable, slot.itemId));
        if (bucket === undefined) {
            slot.state = rowMissing ? 'missing' : 'unverified';
            if (rowMissing) {
                breaks.push({
                    code: 'LOT_SLOT_ROW_MISSING',
                    severity: 'error',
                    hop: `ItemLotParam#${lot.itemLotId}.lotItemId${slot.slot} → ${slot.targetTable}#${slot.itemId}`,
                    message: `ItemLotParam#${lot.itemLotId} 的 slot${slot.slot} 指向 ${slot.targetTable}#${slot.itemId}，但该行不存在：掉落链在这里断了。`
                });
            }
            else {
                diagnostics.push(`${slot.targetTable}#${slot.itemId} 没有被原生读取交付，无法判断它是否解锁。`);
                breaks.push({
                    code: 'LOT_SLOT_UNVERIFIED',
                    severity: 'warning',
                    hop: `ItemLotParam#${lot.itemLotId}.lotItemId${slot.slot} → ${slot.targetTable}#${slot.itemId}`,
                    message: `${slot.targetTable}#${slot.itemId} 存在性未能确认（原生读取没有交付该行），链尾状态未知。`
                });
            }
            continue;
        }
        const isConsume = slot.targetTable === 'EquipParamGoods' ? numberValue(bucket.values.get('isConsume') ?? null) : null;
        const target = {
            table: slot.targetTable,
            rowId: slot.itemId,
            ...(bucket.rowName === undefined ? {} : { rowName: bucket.rowName }),
            isConsume
        };
        slot.target = target;
        if (slot.targetTable !== 'EquipParamGoods') {
            // A weapon/protector roll is a real item, not the "show then delete" display prop; there is no
            // isConsume flag to read, so the chain tail is reported as a delivered item.
            slot.state = 'unlocks';
            pushUniqueTarget(unlocks, target);
            continue;
        }
        if (isConsume === 0) {
            slot.state = 'unlocks';
            pushUniqueTarget(unlocks, target);
            continue;
        }
        if (isConsume === 1) {
            slot.state = 'display-only';
            pushUniqueTarget(displayOnly, target);
            breaks.push({
                code: 'LOT_SLOT_DISPLAY_ONLY',
                severity: 'warning',
                hop: `ItemLotParam#${lot.itemLotId}.lotItemId${slot.slot} → EquipParamGoods#${slot.itemId}`,
                message: `ItemLotParam#${lot.itemLotId} 的 slot${slot.slot} 指向 EquipParamGoods#${slot.itemId}${quoteName(bucket.rowName)}，它是 isConsume=1 的显示道具（获得后屏幕上显示再删除），不解锁任何东西。`
            });
            continue;
        }
        slot.state = 'unverified';
        diagnostics.push(`EquipParamGoods#${slot.itemId} 的 isConsume 没有交付，无法判定是解锁物还是显示道具。`);
        breaks.push({
            code: 'LOT_SLOT_UNVERIFIED',
            severity: 'warning',
            hop: `EquipParamGoods#${slot.itemId}.isConsume`,
            message: `EquipParamGoods#${slot.itemId} 的 isConsume 没有读到，链尾是解锁物还是显示道具未知。`
        });
    }
    const hasUnknownTail = breaks.some((item) => item.code === 'LOT_SLOT_UNVERIFIED' || item.code === 'LOT_SLOT_UNKNOWN_CATEGORY');
    const verdict = unlocks.length > 0
        ? 'unlocks'
        : displayOnly.length > 0 && !hasUnknownTail
            ? 'display-only'
            : hasUnknownTail
                ? 'inconclusive'
                : 'broken';
    // An EMEVD-awarded lot has an event head the caller must be able to quote; the param path keeps
    // its row head. A lot traced on its own already is the first element of the chain; repeating it
    // reads like two rows were involved.
    const awardEventUris = [...new Set((start.emevevd?.awards ?? [])
            .filter((award) => lotIds.includes(award.itemLotId))
            .map((award) => award.eventUri))];
    const sourceTag = awardLotIds.length > 0 && paramLotIds.length > 0
        ? 'param+emevd'
        : awardLotIds.length > 0 ? 'emevd' : 'param';
    const chainHead = awardEventUris.length > 0
        ? `${startLabel}（${sourceTag}：EMEVD ${awardEventUris.join('、')} → AwardItemLot）`
        : `${startLabel}（${sourceTag}）`;
    const chainText = [
        chainHead,
        ...lots
            .filter((lot) => !(start.kind === 'item-lot' && lot.itemLotId === start.itemLotId))
            .map((lot) => rowLabel('ItemLotParam', lot.itemLotId, lot.rowName))
    ].join(' → ');
    const slotRefs = slotTargets.map(({ slot }) => `slot${slot.slot}→${slot.targetTable}#${slot.itemId}`);
    const unlockText = unlocks
        .map((target) => `${rowLabel(target.table, target.rowId, target.rowName)}${target.isConsume === null ? '' : `（isConsume=${target.isConsume}）`}`)
        .join('、');
    const displayText = displayOnly.map((target) => rowLabel(target.table, target.rowId, target.rowName)).join('、');
    let answer;
    if (verdict === 'unlocks') {
        const unassociated = start.emevevd?.unassociatedAwards ?? [];
        const unassociatedSuffix = unassociated.length > 0
            ? `；另有 ${unassociated.length} 条 AwardItemLot 出现在没有死亡/击败条件的事件里（${[...new Set(unassociated.map((award) => award.eventUri))].join('、')}），未计入本次击杀链`
            : '';
        const suffix = displayOnly.length > 0 ? `；另有 ${displayOnly.length} 个槽位只掷显示道具（${displayText}）` : '';
        answer = `${chainText}（${slotRefs.join('，')}）→ ${unlockText}：击杀后解锁这件道具（unlocks）${suffix}${unassociatedSuffix}。`;
    }
    else if (verdict === 'display-only') {
        answer = `${chainText}只掷显示道具 ${displayText}（isConsume=1，获得后屏幕显示再删除）：这个掉落链不解锁任何道具（display-only）。`;
    }
    else if (verdict === 'inconclusive') {
        const reason = breaks.find((item) => item.code === 'LOT_SLOT_UNVERIFIED' || item.code === 'LOT_SLOT_UNKNOWN_CATEGORY')
            ?? breaks.find((item) => item.severity === 'warning');
        const reasonText = reason?.message ?? '链尾状态未知。';
        answer = `${chainText}的链尾未能确认（inconclusive: ${reason?.code ?? 'UNKNOWN_TAIL'}）：${reasonText}`;
    }
    else {
        const reason = breaks.find((item) => item.severity === 'error') ?? breaks[0];
        const reasonText = reason?.message ?? '掉落链没有可解析的链尾。';
        const codeText = reason === undefined ? 'broken' : `broken: ${reason.code}`;
        // Every break message names its own hop, so a message that already starts at the chain head is
        // the whole sentence; prefixing the chain again would print the same row twice.
        answer = reasonText.startsWith(startLabel)
            ? `${reasonText}（${codeText}）`
            : `${chainText}无法解锁任何道具（${codeText}）：${reasonText}`;
    }
    return {
        ok: true,
        result: {
            verdict,
            answer,
            start,
            lots,
            unlocks,
            displayOnly,
            breaks,
            diagnostics,
            paths
        }
    };
}
//# sourceMappingURL=dropChain.js.map