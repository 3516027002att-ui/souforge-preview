import { BLOOD_BAR_INSTRUCTION_NAMES } from './eventInstructionIndex.js';
export const MINIBOSS_BAR_INSTRUCTION = 'DisplayMinibossHealthBar';
export const MINIBOSS_DEFEAT_INSTRUCTION = 'HandleMinibossDefeat';
export const BOSS_BAR_INSTRUCTION = 'DisplayBossHealthBar';
function normalizeTableName(value) {
    return value.replaceAll('_', '').replaceAll('-', '').replaceAll(' ', '').toLocaleLowerCase();
}
function tableMatches(left, right) {
    const a = normalizeTableName(left);
    const b = normalizeTableName(right);
    return a === b || a.startsWith(b) || b.startsWith(a);
}
function findRow(bundle, table, rowId) {
    let tableFound = false;
    for (const param of bundle.params ?? []) {
        if (!tableMatches(param.paramName, table))
            continue;
        tableFound = true;
        const row = (param.rows ?? []).find((candidate) => candidate.rowId === rowId);
        if (row)
            return { row, tableFound: true };
    }
    return { tableFound };
}
function isBackupSource(sourceUri) {
    if (!sourceUri)
        return false;
    const lower = sourceUri.toLocaleLowerCase();
    return lower.endsWith('.bak') || lower.endsWith('.prev') || lower.includes('/.soulforge/');
}
function collectInstances(bundle, rowId) {
    const instances = [];
    const seen = new Set();
    for (const map of (bundle.maps ?? [])) {
        for (const entity of (map.entities ?? [])) {
            // `.msb.dcx.bak` 会被地图索引当成第二个导出；备份不是原生实例，不能进证据。
            if (isBackupSource(entity.sourceUri))
                continue;
            const raw = entity.raw;
            const rawRowId = raw && typeof raw === 'object' && !Array.isArray(raw)
                ? raw.npcParamRowId
                : undefined;
            if (rawRowId !== rowId)
                continue;
            const mapId = entity.mapId || map.mapId;
            const key = `${mapId}#${entity.entityId ?? entity.name}#${entity.name}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            instances.push({
                mapId,
                partName: entity.name,
                ...(entity.entityId === undefined ? {} : { entityId: entity.entityId }),
                npcParamRowId: rowId,
                ...(entity.sourceUri ? { mapSourceUri: entity.sourceUri } : {}),
                ...(entity.position ? { position: entity.position } : {})
            });
        }
    }
    return instances;
}
function renderStatement(reference) {
    const args = Object.entries(reference.args)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(', ');
    return `${reference.instructionName}#${reference.instructionIndex}(${args})`;
}
function toEvidence(reference, kind, provesMiniboss, instance) {
    return {
        kind,
        provesMiniboss,
        instructionName: reference.instructionName,
        bank: reference.bank,
        id: reference.id,
        sourceUri: reference.sourceUri,
        eventId: reference.eventId,
        eventUri: `event://${reference.mapId ?? instance.mapId}/${reference.eventId}`,
        instructionIndex: reference.instructionIndex,
        entityId: reference.entityId,
        entityArgName: reference.entityArgName,
        ...(reference.mapId ? { mapId: reference.mapId } : {}),
        partName: instance.partName,
        args: reference.args,
        statement: renderStatement(reference)
    };
}
/**
 * 判定一个 NpcParam 行是否 miniboss。纯函数：索引与 symbol bundle 由调用方提供，
 * 因此可以用合成夹具做单元测试，也可以在工具层复用同一份 index 缓存。
 */
export function explainMiniboss(input) {
    const table = input.table?.trim() || 'NpcParam';
    const rowId = input.npcParamRowId;
    const maxEvidence = Math.max(1, Math.min(500, input.maxEvidence ?? 100));
    const { row, tableFound } = findRow(input.bundle, table, rowId);
    const instances = collectInstances(input.bundle, rowId);
    const evidence = [];
    const supporting = [];
    const caveats = [];
    const blockedReasons = [];
    const seenEvidence = new Set();
    for (const instance of instances) {
        if (instance.entityId === undefined)
            continue;
        const references = input.index.byEntityId.get(instance.entityId) ?? [];
        for (const reference of references) {
            if (reference.mapId !== undefined && instance.mapId !== undefined && reference.mapId !== instance.mapId)
                continue;
            const disabled = reference.args.disabledEnabled;
            if (reference.instructionName === MINIBOSS_BAR_INSTRUCTION && disabled === 0) {
                const key = `bar#${reference.sourceUri}#${reference.eventId}#${reference.instructionIndex}`;
                if (seenEvidence.has(key))
                    continue;
                seenEvidence.add(key);
                evidence.push(toEvidence(reference, 'miniboss-health-bar-enabled', true, instance));
            }
            else if (reference.instructionName === MINIBOSS_DEFEAT_INSTRUCTION) {
                const key = `defeat#${reference.sourceUri}#${reference.eventId}#${reference.instructionIndex}`;
                if (seenEvidence.has(key))
                    continue;
                seenEvidence.add(key);
                evidence.push(toEvidence(reference, 'miniboss-defeat-handler', true, instance));
            }
            else if (reference.instructionName === BOSS_BAR_INSTRUCTION && disabled === 1) {
                const key = `boss#${reference.sourceUri}#${reference.eventId}#${reference.instructionIndex}`;
                if (seenEvidence.has(key))
                    continue;
                seenEvidence.add(key);
                supporting.push(toEvidence(reference, 'boss-health-bar-disabled', false, instance));
            }
        }
    }
    const maps = [];
    for (const mapId of [...new Set(instances.map((instance) => instance.mapId))]) {
        const files = input.index.files.filter((file) => file.mapId === mapId);
        const readOkFiles = files.filter((file) => file.readOk).length;
        maps.push({
            mapId,
            instances: instances.filter((instance) => instance.mapId === mapId).length,
            eventFiles: files.length,
            readOkFiles,
            minibossInstructions: files.reduce((sum, file) => sum + file.minibossInstructions, 0),
            parameterizedEntityArgs: files.reduce((sum, file) => sum + file.parameterizedEntityArgs, 0),
            parameterizedBloodBarInstructions: files.reduce((sum, file) => sum + file.parameterizedBloodBarInstructions, 0),
            complete: files.length > 0 && readOkFiles === files.length
        });
    }
    const allMapsCovered = maps.length > 0 && maps.every((map) => map.complete);
    const allInstancesAttributable = instances.length > 0 && instances.every((instance) => instance.entityId !== undefined);
    // 否定结论只看**本行所在地图**的事件文件：别的 map 读失败不应该把 m13 的
    // “确实没有”降级，反过来 m13 自己的文件没读全时也绝不允许输出 no-evidence。
    const relevantFiles = input.index.files.filter((file) => maps.some((map) => map.mapId === file.mapId));
    const relevantUnread = relevantFiles.filter((file) => !file.readOk);
    const relevantUnknown = relevantFiles.reduce((sum, file) => sum + file.unknownInstructions, 0);
    const relevantDecodeFailures = relevantFiles.reduce((sum, file) => sum + file.decodeFailures, 0);
    const relevantCoverageComplete = relevantFiles.length > 0
        && relevantUnread.length === 0
        && relevantUnknown === 0
        && relevantDecodeFailures === 0;
    // 无法归属的实体实参：只有**血条类**指令才把“没找到”变成“看不见”。
    // 普通指令（ChangeCharacterEnableState 等）即使参数化也与 miniboss 判定无关。
    const relevantParameterized = relevantFiles.reduce((sum, file) => sum + file.parameterizedEntityArgs, 0);
    const relevantParameterizedBloodBar = relevantFiles.reduce((sum, file) => sum + file.parameterizedBloodBarInstructions, 0);
    const parameterizedBloodBarNames = [...new Set(relevantFiles.flatMap((file) => file.parameterizedBloodBarInstructionNames))].sort();
    const parameterizedBlocksNegative = relevantParameterizedBloodBar > 0;
    const negativeConclusionAllowed = relevantCoverageComplete
        && allMapsCovered
        && allInstancesAttributable
        && !parameterizedBlocksNegative;
    if (relevantUnread.length > 0)
        blockedReasons.push('EVENT_INDEX_FILES_UNREAD');
    if (relevantUnknown > 0)
        blockedReasons.push('EVENT_INDEX_UNKNOWN_INSTRUCTIONS');
    if (relevantDecodeFailures > 0)
        blockedReasons.push('EVENT_INDEX_DECODE_FAILURES');
    if (parameterizedBlocksNegative) {
        blockedReasons.push(`EVENT_INDEX_PARAMETERIZED_BLOOD_BAR_INSTRUCTIONS:有 ${relevantParameterizedBloodBar} 条血条类指令`
            + `（${parameterizedBloodBarNames.join('、')}）的实体实参来自公共事件形参（X<offset>_<width>），`
            + '无法归属到具体实体；其中任意一条都可能指向本行实例，因此“没找到证据”不等于“不是 miniboss”。');
    }
    if (input.index.coverage.filesFailed > relevantUnread.length) {
        caveats.push(`全量事件索引还有 ${input.index.coverage.filesFailed - relevantUnread.length} 个与本行无关的文件未读全；它们不参与本行的否定结论。`);
    }
    if (instances.length > 0 && !allMapsCovered)
        blockedReasons.push('EVENT_INDEX_MAP_NOT_COVERED');
    if (instances.some((instance) => instance.entityId === undefined))
        blockedReasons.push('MAP_INSTANCE_ENTITY_ID_MISSING');
    if (row === undefined)
        blockedReasons.push(tableFound ? 'PARAM_ROW_NOT_FOUND' : 'PARAM_TABLE_NOT_INDEXED');
    if (relevantParameterized > 0) {
        if (parameterizedBlocksNegative) {
            const blockedNote = evidence.length > 0
                ? '本行已有直接证据，所以仍判 miniboss；但这些无法归属的调用同样不能当作反证。'
                : '这些调用可能正指向本行实例，既不算证据也不算反证；所以“没找到证据”只能给出 inconclusive，不能给出 no-evidence。';
            caveats.push(`本行所在地图的事件索引中有 ${relevantParameterized} 条指令的实体实参来自公共事件形参（X<offset>_<width>），`
                + `无法归属到具体实体；其中 ${relevantParameterizedBloodBar} 条是血条类指令（${parameterizedBloodBarNames.join('、')}）。`
                + blockedNote);
        }
        else {
            caveats.push(`本行所在地图的事件索引中有 ${relevantParameterized} 条指令的实体实参来自公共事件形参（X<offset>_<width>），`
                + '无法归属到具体实体；这些指令里不含血条类指令名'
                + `（${BLOOD_BAR_INSTRUCTION_NAMES.join('/')}），与 miniboss 判定无关，`
                + '因此不影响本行的否定结论（它们仍然既不算证据也不算反证）。');
        }
    }
    if (instances.length === 0) {
        caveats.push('该 NpcParam 行在已索引的地图里没有实例；没有实例就不能据此判定它不是 miniboss。');
    }
    if (maps.some((map) => map.eventFiles === 0)) {
        caveats.push(`地图 ${maps.filter((map) => map.eventFiles === 0).map((map) => map.mapId).join(', ')} 没有已索引的事件文件；该地图上的“无证据”不成立。`);
    }
    if (evidence.length === 0 && maps.some((map) => map.minibossInstructions > 0)) {
        caveats.push(`这些地图的 EMEVD 中确实出现 miniboss 指令（${maps.map((map) => `${map.mapId}=${map.minibossInstructions}`).join(', ')} 次），但没有一条绑定到该实体；调用次数本身不能替代实体证据。`);
    }
    const verdict = evidence.length > 0
        ? 'miniboss'
        : negativeConclusionAllowed
            ? 'no-evidence'
            : 'inconclusive';
    const isMiniboss = verdict === 'miniboss' ? true : verdict === 'no-evidence' ? false : null;
    const limitEvidence = evidence.slice(0, maxEvidence);
    if (evidence.length > limitEvidence.length) {
        caveats.push(`证据共 ${evidence.length} 条，本次只返回前 ${limitEvidence.length} 条。`);
    }
    return {
        table,
        npcParamRowId: rowId,
        isMiniboss,
        verdict,
        row: {
            found: row !== undefined,
            ...(row?.rowName ? { rowName: row.rowName } : {}),
            ...(row?.sourceUri ? { sourceUri: row.sourceUri } : {})
        },
        instances,
        evidence: limitEvidence,
        supporting: supporting.slice(0, maxEvidence),
        coverage: {
            index: input.index.coverage,
            maps,
            parameterizedEntityArgs: relevantParameterized,
            parameterizedBloodBarInstructions: relevantParameterizedBloodBar,
            parameterizedBlocksNegative,
            negativeConclusionAllowed
        },
        blockedReasons,
        caveats
    };
}
//# sourceMappingURL=minibossEvidence.js.map