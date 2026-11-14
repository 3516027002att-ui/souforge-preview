import { eventInstructionEventKey, DEFEAT_CONDITION_INSTRUCTION_NAMES, DEFEAT_HANDLER_INSTRUCTION_NAMES } from '../references/eventInstructionIndex.js';
import { isCommonEmevdNamespace } from '../references/emevdRoleRules.js';
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
            // A `.msb.dcx.bak` sibling is indexed as a second export; it is not a native
            // instance and must not add a duplicate entity id to the evidence.
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
                ...(entity.sourceUri ? { mapSourceUri: entity.sourceUri } : {})
            });
        }
    }
    return instances;
}
function isCommonEventFile(sourceUri) {
    return isCommonEmevdNamespace(sourceUri);
}
function renderStatement(instructionName, instructionIndex, args, parameterized) {
    const rendered = Object.entries(args).map(([name, value]) => `${name}=${String(value)}`);
    if (parameterized)
        rendered.push('itemLotId=<event parameter>');
    return `${instructionName}#${instructionIndex}(${rendered.join(', ')})`;
}
/**
 * Join one NpcParam row to its EMEVD awards.
 *
 * Coverage is scoped to the row's maps plus `common`/`common_func` (where boss
 * kill handlers commonly live); an unread file in an unrelated map cannot turn
 * this row's "no award" into "cannot decide". Missing instances are different:
 * without an entityId there is no join at all, so the caller gets `complete=false`.
 */
export function collectDropChainEmevdEvidence(input) {
    const table = input.table?.trim() || 'NpcParam';
    const instances = collectInstances(input.bundle, input.rowId);
    const entityIds = [...new Set(instances.map((instance) => instance.entityId).filter((value) => value !== undefined))];
    const notes = [];
    const buckets = new Map();
    for (const instance of instances) {
        if (instance.entityId === undefined)
            continue;
        for (const reference of input.index.byEntityId.get(instance.entityId) ?? []) {
            // Common events are global namespaces: their derived mapId is `common` /
            // `common_func`, not the instance's map. Only real map files are map-scoped.
            if (reference.mapId !== undefined
                && instance.mapId !== undefined
                && reference.mapId !== instance.mapId
                && !isCommonEventFile(reference.sourceUri))
                continue;
            const key = eventInstructionEventKey(reference.sourceUri, reference.eventId);
            const defeatLike = DEFEAT_CONDITION_INSTRUCTION_NAMES.includes(reference.instructionName)
                || DEFEAT_HANDLER_INSTRUCTION_NAMES.includes(reference.instructionName);
            const bucket = buckets.get(key) ?? {
                sourceUri: reference.sourceUri,
                ...(reference.mapId ? { mapId: reference.mapId } : {}),
                eventId: reference.eventId,
                entityIds: new Set(),
                defeatLike: false
            };
            bucket.entityIds.add(instance.entityId);
            bucket.defeatLike ||= defeatLike;
            buckets.set(key, bucket);
        }
    }
    const candidateEvents = [...buckets.values()]
        .sort((left, right) => left.sourceUri.localeCompare(right.sourceUri) || left.eventId - right.eventId)
        .map((bucket) => ({
        sourceUri: bucket.sourceUri,
        ...(bucket.mapId ? { mapId: bucket.mapId } : {}),
        eventId: bucket.eventId,
        eventUri: `event://${bucket.mapId ?? 'unknown'}/${bucket.eventId}`,
        entityIds: [...bucket.entityIds].sort((left, right) => left - right)
    }));
    const awards = [];
    const unassociatedAwards = [];
    const unresolvedAwards = [];
    const handlers = [];
    const firstEntityId = (entityIds) => entityIds.values().next().value;
    for (const bucket of buckets.values()) {
        const key = eventInstructionEventKey(bucket.sourceUri, bucket.eventId);
        const entityId = firstEntityId(bucket.entityIds);
        for (const award of input.index.awardItemLotsByEvent.get(key) ?? []) {
            const statement = renderStatement(award.instructionName, award.instructionIndex, award.args, award.parameterized);
            if (award.itemLotId !== null) {
                const target = bucket.defeatLike ? awards : unassociatedAwards;
                target.push({
                    itemLotId: award.itemLotId,
                    sourceUri: award.sourceUri,
                    ...(award.mapId ? { mapId: award.mapId } : {}),
                    eventId: award.eventId,
                    eventUri: `event://${award.mapId ?? 'unknown'}/${award.eventId}`,
                    instructionIndex: award.instructionIndex,
                    instructionName: award.instructionName,
                    args: award.args,
                    statement,
                    ...(entityId === undefined ? {} : { entityId })
                });
            }
            else if (award.parameterized && bucket.defeatLike) {
                unresolvedAwards.push({
                    sourceUri: award.sourceUri,
                    ...(award.mapId ? { mapId: award.mapId } : {}),
                    eventId: award.eventId,
                    eventUri: `event://${award.mapId ?? 'unknown'}/${award.eventId}`,
                    instructionIndex: award.instructionIndex,
                    instructionName: award.instructionName,
                    parameterized: true,
                    statement,
                    ...(entityId === undefined ? {} : { entityId })
                });
            }
            // A literal `AwardItemLot(itemLotId=0)` is a no-op, neither award nor gap.
        }
        for (const signal of input.index.defeatSignalsByEvent.get(key) ?? []) {
            handlers.push({
                sourceUri: signal.sourceUri,
                ...(signal.mapId ? { mapId: signal.mapId } : {}),
                eventId: signal.eventId,
                eventUri: `event://${signal.mapId ?? 'unknown'}/${signal.eventId}`,
                instructionIndex: signal.instructionIndex,
                instructionName: signal.instructionName,
                statement: renderStatement(signal.instructionName, signal.instructionIndex, signal.args, false),
                ...(entityId === undefined ? {} : { entityId })
            });
        }
    }
    awards.sort((left, right) => left.eventUri.localeCompare(right.eventUri) || left.instructionIndex - right.instructionIndex);
    unassociatedAwards.sort((left, right) => left.eventUri.localeCompare(right.eventUri) || left.instructionIndex - right.instructionIndex);
    unresolvedAwards.sort((left, right) => left.eventUri.localeCompare(right.eventUri) || left.instructionIndex - right.instructionIndex);
    handlers.sort((left, right) => left.eventUri.localeCompare(right.eventUri) || left.instructionIndex - right.instructionIndex);
    const relevantMapIds = new Set(instances.map((instance) => instance.mapId));
    const relevantFiles = input.index.files.filter((file) => file.mapId !== undefined
        && (relevantMapIds.has(file.mapId) || isCommonEventFile(file.sourceUri)));
    const relevantUnread = relevantFiles.filter((file) => !file.readOk);
    const unknownInstructions = relevantFiles.reduce((sum, file) => sum + file.unknownInstructions, 0);
    const decodeFailures = relevantFiles.reduce((sum, file) => sum + file.decodeFailures, 0);
    const complete = instances.length > 0
        && relevantFiles.length > 0
        && relevantUnread.length === 0
        && unknownInstructions === 0
        && decodeFailures === 0;
    const coverage = {
        status: instances.length === 0 || relevantFiles.length === 0
            ? 'unavailable'
            : complete ? 'complete' : 'partial',
        filesDiscovered: relevantFiles.length,
        filesRead: relevantFiles.length - relevantUnread.length,
        filesFailed: relevantUnread.length,
        unknownInstructions,
        decodeFailures,
        complete
    };
    if (instances.length === 0) {
        notes.push('该 NpcParam 行在已索引地图里没有实例（MSB npcParamRowId 外键未命中），无法把任何 EMEVD 事件归到这一行。');
    }
    else if (entityIds.length === 0) {
        notes.push('该行的地图实例没有 entityId，无法与事件里的实体实参连接。');
    }
    if (relevantFiles.length === 0) {
        notes.push('该行所在地图没有已索引的事件文件，EMEVD 路径不可用。');
    }
    if (relevantUnread.length > 0) {
        notes.push(`该行相关的事件文件有 ${relevantUnread.length} 个没有读出：${relevantUnread.map((file) => file.sourceUri).join('、')}。`);
    }
    if (unknownInstructions > 0 || decodeFailures > 0) {
        notes.push(`该行相关的事件文件里有 ${unknownInstructions} 条未知指令、${decodeFailures} 条解码失败；未解码的 AwardItemLot 不能被当作“没有”。`);
    }
    if (candidateEvents.length === 0 && instances.length > 0 && entityIds.length > 0 && complete) {
        notes.push('该行的 entityId 没有被任何已索引事件字面引用；该 NPC 没有可归属的击杀事件。');
    }
    if (unassociatedAwards.length > 0) {
        notes.push(`有 ${unassociatedAwards.length} 条 AwardItemLot 出现在引用该实体、但没有死亡/击败条件的事件里`
            + `（${[...new Set(unassociatedAwards.map((award) => award.eventUri))].join('、')}）；`
            + '它们可能是场景奖励而不是击杀奖励，未作为该 NPC 的掉落链。');
    }
    return {
        table,
        rowId: input.rowId,
        instances,
        entityIds,
        candidateEvents,
        awards,
        unassociatedAwards,
        unresolvedAwards,
        handlers,
        coverage,
        notes
    };
}
//# sourceMappingURL=dropChainEmevd.js.map