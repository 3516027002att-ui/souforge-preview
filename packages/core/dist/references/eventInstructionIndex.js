import { decodeInstructionArgs, findInstructionDef } from '../emevd/emedfSchema.js';
/** EMEDF 参数名就是 registry 元数据，不是按指令名做的子串猜测。 */
export const ENTITY_ARG_NAMES = Object.freeze(['entityId', 'targetEntityId']);
export const PARAMETERIZED_ARG_NAMES_BY_ROLE = Object.freeze({
    entity: ENTITY_ARG_NAMES,
    event: Object.freeze(['eventId', 'targetEventId', 'multiplayerEventId']),
    text: Object.freeze([
        'textId',
        'messageId',
        'titleMessageId',
        'bodyMessageId',
        'targetEventMessageId',
        'areaNameMessageId',
        'helpMessageId',
        'pretitleMessageId',
        'nameId',
        'menuTextId'
    ])
});
const PARAMETERIZED_ROLE_BY_NAME = new Map(Object.entries(PARAMETERIZED_ARG_NAMES_BY_ROLE)
    .flatMap(([role, names]) => names.map((name) => [name.toLowerCase(), role])));
function parameterizedArgRole(argName) {
    return PARAMETERIZED_ROLE_BY_NAME.get(argName.toLowerCase());
}
/**
 * 与 miniboss 判定直接相关的指令名。索引按文件统计它们的出现次数（包含
 * 实体实参参数化的调用），这样“扫过但没有”可以写成 0 次，而不是只说没命中。
 */
export const MINIBOSS_EVIDENCE_INSTRUCTION_NAMES = Object.freeze([
    'DisplayMinibossHealthBar',
    'HandleMinibossDefeat'
]);
/**
 * 血条类指令名。它们决定 miniboss 身份（`DisplayMinibossHealthBar`、
 * `HandleMinibossDefeat`），或至少与血条归属有关（`DisplayBossHealthBar`
 * 的显式关闭）。一条血条类指令的实体实参如果是公共事件形参
 * （`X<offset>_<width>`），它可能正好指向目标实体，只是索引看不见——
 * 这种“无法归属”必须能和“确实不存在”区分开。
 */
export const BLOOD_BAR_INSTRUCTION_NAMES = Object.freeze([
    'DisplayMinibossHealthBar',
    'HandleMinibossDefeat',
    'DisplayBossHealthBar'
]);
/**
 * Drop-chain evidence carried by the same pass over every EMEVD file.
 *
 * `AwardItemLot(itemLotId)` does **not** carry an entityId, so it never appears in
 * `byEntityId`. A drop chain needs it joined to the events that reference the NPC's
 * map instance; keeping the award instructions here avoids a second 47-file read.
 */
export const AWARD_ITEM_LOT_INSTRUCTION_NAME = 'AwardItemLot';
/**
 * Instructions that prove an EMEVD event is the NPC's defeat handler. They are
 * not item-lot awards themselves: a boss may be handled here with its reward
 * outside ItemLotParam. The drop-chain resolver uses this to avoid calling a
 * handler-driven boss "broken" just because no lot exists.
 */
export const DEFEAT_HANDLER_INSTRUCTION_NAMES = Object.freeze([
    'HandleBossDefeat',
    'HandleMinibossDefeat',
    'HandleBossDefeatAndDisplayBanner',
    'DisplayBossHealthBar',
    'DisplayMinibossHealthBar'
]);
/**
 * Conditions that make an event a defeat event for the referenced entity. An
 * `AwardItemLot` in an event that merely mentions the entity (a cutscene, a
 * backread toggle) is not that NPC's kill reward; the drop-chain join uses this
 * list before trusting an award.
 */
export const DEFEAT_CONDITION_INSTRUCTION_NAMES = Object.freeze([
    'IFCharacterDeadAlive',
    'IFCharacterDead',
    'IFCharacterHPValue',
    'IFCharacterHPRatio',
    'IFNumberOfCharacterHealthBars'
]);
/** Stable key for joining per-event evidence (`sourceUri` + native event id). */
export function eventInstructionEventKey(sourceUri, eventId) {
    return `${sourceUri}\u0000${eventId}`;
}
/** 从 `file://event/m11_00_00_00.emevd.dcx` 取 `m11_00_00_00`。 */
export function eventMapIdFromSourceUri(sourceUri) {
    const normalized = sourceUri.replaceAll('\\', '/');
    const match = /(?:^|[^A-Za-z0-9_])([A-Za-z0-9_]+)\.emevd(?:\.dcx)?$/iu.exec(normalized);
    return match?.[1];
}
function isEmevdSource(file) {
    return /\.emevd(?:\.dcx)?$/iu.test(file.absolutePath) || /\.emevd(?:\.dcx)?$/iu.test(file.sourceUri);
}
function toScalar(value) {
    return value;
}
function readParameters(event) {
    const raw = event.parameters;
    if (!Array.isArray(raw))
        return [];
    const records = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            continue;
        const row = item;
        const values = ['instructionIndex', 'targetStartByte', 'sourceStartByte', 'byteCount'].map((key) => row[key]);
        if (!values.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))
            continue;
        records.push({
            instructionIndex: values[0],
            targetStartByte: values[1],
            sourceStartByte: values[2],
            byteCount: values[3]
        });
    }
    return records;
}
/**
 * 读所有事件文件并建立实体倒排。调用方负责提供已按 `isActiveSemanticSource`
 * 过滤的 event 文件；本函数不会把 `.bak`/缓存文件当成事件源。
 */
export async function buildEventInstructionIndex(input) {
    const startedAt = Date.now();
    const files = [];
    const entityReferences = [];
    const awardItemLots = [];
    const defeatSignals = [];
    const failures = [];
    const sources = input.files.filter(isEmevdSource);
    let eventsScanned = 0;
    let instructionsScanned = 0;
    let instructionsDecoded = 0;
    let unknownInstructions = 0;
    let decodeFailures = 0;
    let parameterizedEntityArgs = 0;
    const parameterizedInstructionCounts = new Map();
    let parameterizedEventArgs = 0;
    const parameterizedEventInstructionCounts = new Map();
    let parameterizedTextArgs = 0;
    const parameterizedTextInstructionCounts = new Map();
    let parameterizedBloodBarInstructions = 0;
    const parameterizedBloodBarInstructionNames = new Set();
    let filesRead = 0;
    for (const file of sources) {
        const mapId = file.mapId ?? eventMapIdFromSourceUri(file.sourceUri);
        const fileParameterizedInstructionCounts = new Map();
        const fileParameterizedEventInstructionCounts = new Map();
        const fileParameterizedTextInstructionCounts = new Map();
        const coverage = {
            sourceUri: file.sourceUri,
            ...(mapId ? { mapId } : {}),
            readOk: false,
            events: 0,
            instructions: 0,
            decodedInstructions: 0,
            unknownInstructions: 0,
            decodeFailures: 0,
            parameterizedEntityArgs: 0,
            parameterizedInstructionCounts: [],
            parameterizedEventArgs: 0,
            parameterizedEventInstructionCounts: [],
            parameterizedTextArgs: 0,
            parameterizedTextInstructionCounts: [],
            parameterizedBloodBarInstructions: 0,
            parameterizedBloodBarInstructionNames: [],
            minibossInstructions: 0
        };
        files.push(coverage);
        if (input.signal?.aborted) {
            coverage.errorCode = 'EMEVD_EVENT_INDEX_CANCELLED';
            coverage.errorMessage = '索引构建已取消。';
            failures.push({ sourceUri: file.sourceUri, code: 'EMEVD_EVENT_INDEX_CANCELLED', message: '索引构建已取消。' });
            continue;
        }
        let result;
        try {
            result = await input.readDocument(file);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            coverage.errorCode = 'EMEVD_EVENT_INDEX_READ_FAILED';
            coverage.errorMessage = message;
            failures.push({ sourceUri: file.sourceUri, code: 'EMEVD_EVENT_INDEX_READ_FAILED', message });
            continue;
        }
        if (!result.ok || !result.document) {
            const diagnostic = result.diagnostics?.[0];
            coverage.errorCode = diagnostic?.code ?? 'EMEVD_EVENT_INDEX_READ_FAILED';
            coverage.errorMessage = diagnostic?.message ?? '完整事件文档读取失败。';
            failures.push({
                sourceUri: file.sourceUri,
                code: coverage.errorCode,
                message: coverage.errorMessage
            });
            continue;
        }
        coverage.readOk = true;
        if (result.sourceHash !== undefined)
            coverage.sourceHash = result.sourceHash;
        if (result.outerFileHash !== undefined)
            coverage.outerFileHash = result.outerFileHash;
        filesRead += 1;
        for (const event of result.document.events) {
            coverage.events += 1;
            eventsScanned += 1;
            const parameters = readParameters(event);
            for (let index = 0; index < event.instructions.length; index += 1) {
                const instruction = event.instructions[index];
                coverage.instructions += 1;
                instructionsScanned += 1;
                if (instruction.unknown) {
                    coverage.unknownInstructions += 1;
                    unknownInstructions += 1;
                    continue;
                }
                const def = findInstructionDef(input.registry, instruction.bank, instruction.id);
                if (!def) {
                    coverage.unknownInstructions += 1;
                    unknownInstructions += 1;
                    continue;
                }
                if (MINIBOSS_EVIDENCE_INSTRUCTION_NAMES.includes(def.name))
                    coverage.minibossInstructions += 1;
                let decoded;
                try {
                    decoded = decodeInstructionArgs(input.registry, instruction.bank, instruction.id, Buffer.from(instruction.argsBase64, 'base64'));
                }
                catch {
                    coverage.decodeFailures += 1;
                    decodeFailures += 1;
                    continue;
                }
                if (!decoded.ok) {
                    coverage.decodeFailures += 1;
                    decodeFailures += 1;
                    continue;
                }
                coverage.decodedInstructions += 1;
                instructionsDecoded += 1;
                const args = {};
                let parameterizedEntity = false;
                let parameterizedEvent = false;
                let parameterizedText = false;
                for (const arg of decoded.args) {
                    const parameter = parameters.find((item) => item.instructionIndex === index
                        && arg.startByte !== undefined
                        && item.targetStartByte === arg.startByte);
                    if (parameter) {
                        const role = parameterizedArgRole(arg.name);
                        if (role === 'entity')
                            parameterizedEntity = true;
                        else if (role === 'event')
                            parameterizedEvent = true;
                        else if (role === 'text')
                            parameterizedText = true;
                        continue;
                    }
                    args[arg.name] = toScalar(arg.value);
                }
                if (def.name === AWARD_ITEM_LOT_INSTRUCTION_NAME) {
                    const itemLotArg = decoded.args.find((arg) => arg.name === 'itemLotId');
                    const itemLotParameterized = itemLotArg !== undefined
                        && parameters.some((item) => item.instructionIndex === index
                            && itemLotArg.startByte !== undefined
                            && item.targetStartByte === itemLotArg.startByte);
                    const literalItemLotId = itemLotArg !== undefined
                        && !itemLotParameterized
                        && typeof itemLotArg.value === 'number'
                        && Number.isSafeInteger(itemLotArg.value)
                        && itemLotArg.value > 0
                        ? itemLotArg.value
                        : null;
                    awardItemLots.push({
                        sourceUri: file.sourceUri,
                        ...(mapId ? { mapId } : {}),
                        eventId: event.eventId,
                        instructionIndex: index,
                        bank: instruction.bank,
                        id: instruction.id,
                        instructionName: def.name,
                        itemLotId: literalItemLotId,
                        parameterized: itemLotParameterized,
                        args
                    });
                }
                if (DEFEAT_HANDLER_INSTRUCTION_NAMES.includes(def.name)) {
                    defeatSignals.push({
                        sourceUri: file.sourceUri,
                        ...(mapId ? { mapId } : {}),
                        eventId: event.eventId,
                        instructionIndex: index,
                        instructionName: def.name,
                        args
                    });
                }
                if (parameterizedEntity) {
                    coverage.parameterizedEntityArgs += 1;
                    parameterizedEntityArgs += 1;
                    fileParameterizedInstructionCounts.set(def.name, (fileParameterizedInstructionCounts.get(def.name) ?? 0) + 1);
                    parameterizedInstructionCounts.set(def.name, (parameterizedInstructionCounts.get(def.name) ?? 0) + 1);
                    if (BLOOD_BAR_INSTRUCTION_NAMES.includes(def.name)) {
                        coverage.parameterizedBloodBarInstructions += 1;
                        parameterizedBloodBarInstructions += 1;
                        if (!coverage.parameterizedBloodBarInstructionNames.includes(def.name)) {
                            coverage.parameterizedBloodBarInstructionNames.push(def.name);
                        }
                        parameterizedBloodBarInstructionNames.add(def.name);
                    }
                }
                if (parameterizedEvent) {
                    coverage.parameterizedEventArgs += 1;
                    parameterizedEventArgs += 1;
                    fileParameterizedEventInstructionCounts.set(def.name, (fileParameterizedEventInstructionCounts.get(def.name) ?? 0) + 1);
                    parameterizedEventInstructionCounts.set(def.name, (parameterizedEventInstructionCounts.get(def.name) ?? 0) + 1);
                }
                if (parameterizedText) {
                    coverage.parameterizedTextArgs += 1;
                    parameterizedTextArgs += 1;
                    fileParameterizedTextInstructionCounts.set(def.name, (fileParameterizedTextInstructionCounts.get(def.name) ?? 0) + 1);
                    parameterizedTextInstructionCounts.set(def.name, (parameterizedTextInstructionCounts.get(def.name) ?? 0) + 1);
                }
                for (const argName of ENTITY_ARG_NAMES) {
                    const value = args[argName];
                    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0)
                        continue;
                    entityReferences.push({
                        entityId: value,
                        entityArgName: argName,
                        sourceUri: file.sourceUri,
                        ...(mapId ? { mapId } : {}),
                        eventId: event.eventId,
                        instructionIndex: index,
                        bank: instruction.bank,
                        id: instruction.id,
                        instructionName: def.name,
                        args
                    });
                }
            }
        }
        coverage.parameterizedInstructionCounts = [...fileParameterizedInstructionCounts]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
        coverage.parameterizedEventInstructionCounts = [...fileParameterizedEventInstructionCounts]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
        coverage.parameterizedTextInstructionCounts = [...fileParameterizedTextInstructionCounts]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    }
    const byEntityId = new Map();
    for (const reference of entityReferences) {
        const list = byEntityId.get(reference.entityId);
        if (list)
            list.push(reference);
        else
            byEntityId.set(reference.entityId, [reference]);
    }
    const awardItemLotsByEvent = new Map();
    for (const award of awardItemLots) {
        const key = eventInstructionEventKey(award.sourceUri, award.eventId);
        const list = awardItemLotsByEvent.get(key);
        if (list)
            list.push(award);
        else
            awardItemLotsByEvent.set(key, [award]);
    }
    const defeatSignalsByEvent = new Map();
    for (const signal of defeatSignals) {
        const key = eventInstructionEventKey(signal.sourceUri, signal.eventId);
        const list = defeatSignalsByEvent.get(key);
        if (list)
            list.push(signal);
        else
            defeatSignalsByEvent.set(key, [signal]);
    }
    const filesFailed = sources.length - filesRead;
    const status = sources.length === 0
        ? 'unavailable'
        : filesFailed > 0 || decodeFailures > 0 || unknownInstructions > 0
            ? 'partial'
            : 'complete';
    const coverage = {
        status,
        filesDiscovered: sources.length,
        filesRead,
        filesFailed,
        eventsScanned,
        instructionsScanned,
        instructionsDecoded,
        unknownInstructions,
        decodeFailures,
        parameterizedEntityArgs,
        parameterizedInstructionCounts: [...parameterizedInstructionCounts]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
        parameterizedEventArgs,
        parameterizedEventInstructionCounts: [...parameterizedEventInstructionCounts]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
        parameterizedTextArgs,
        parameterizedTextInstructionCounts: [...parameterizedTextInstructionCounts]
            .map(([name, count]) => ({ name, count }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
        parameterizedBloodBarInstructions,
        parameterizedBloodBarInstructionNames: [...parameterizedBloodBarInstructionNames].sort(),
        structuralNegativeConclusionAllowed: status === 'complete',
        failures
    };
    return {
        workspaceId: input.workspaceId,
        builtAt: Date.now(),
        buildMs: Date.now() - startedAt,
        files,
        entityReferences,
        byEntityId,
        awardItemLots,
        awardItemLotsByEvent,
        defeatSignals,
        defeatSignalsByEvent,
        coverage
    };
}
/**
 * 倒排查询。`entityId` 命中按 (sourceUri, eventId, instructionIndex) 去重，
 * 保证同一指令同时带 entityId/targetEntityId 时只出现一次。
 */
export function searchEventInstructionReferences(index, query) {
    const instructionName = query.instructionName?.trim().toLocaleLowerCase();
    const contains = query.instructionContains?.trim().toLocaleLowerCase();
    const sourceUri = query.sourceUri?.trim();
    const mapId = query.mapId?.trim();
    const candidates = query.entityId === undefined ? index.entityReferences : (index.byEntityId.get(query.entityId) ?? []);
    const seen = new Set();
    const matched = [];
    for (const reference of candidates) {
        if (instructionName !== undefined && reference.instructionName.toLocaleLowerCase() !== instructionName)
            continue;
        if (contains !== undefined && !reference.instructionName.toLocaleLowerCase().includes(contains))
            continue;
        if (query.eventId !== undefined && reference.eventId !== query.eventId)
            continue;
        if (sourceUri !== undefined && reference.sourceUri !== sourceUri)
            continue;
        if (mapId !== undefined && reference.mapId !== mapId)
            continue;
        const key = `${reference.sourceUri}#${reference.eventId}#${reference.instructionIndex}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        matched.push(reference);
    }
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const limit = Math.max(1, Math.trunc(query.limit));
    const page = matched.slice(offset, offset + limit);
    return {
        matches: page,
        total: matched.length,
        offset,
        limit,
        truncated: offset + page.length < matched.length
    };
}
/** 索引失败项转成工具层可读诊断（不吞错误）。 */
export function eventInstructionIndexDiagnostics(index) {
    return index.coverage.failures.map((failure) => ({
        severity: 'warning',
        code: failure.code,
        message: `${failure.sourceUri}：${failure.message}`,
        sourceUri: failure.sourceUri
    }));
}
const INDEX_CACHE_LIMIT = 2;
const indexCache = new Map();
const inFlight = new Map();
function fingerprintFiles(files) {
    return files
        .map((file) => `${file.sourceUri}:${file.size ?? '?'}:${file.mtimeMs ?? '?'}`)
        .sort()
        .join('|');
}
/**
 * 同一工作区 + 同一文件指纹只建一次；并发调用合并到同一个 promise。
 * 索引是只读投影，文件大小/mtime 任一变化都会换指纹重建。
 */
export async function getEventInstructionIndex(input) {
    const fingerprint = fingerprintFiles(input.files);
    const key = `${input.workspaceId}#${fingerprint}`;
    const cached = indexCache.get(key);
    if (cached) {
        // 触碰 LRU：Map 保持插入顺序，删除后重插即最近使用。
        indexCache.delete(key);
        indexCache.set(key, cached);
        return cached.index;
    }
    const running = inFlight.get(key);
    if (running)
        return running;
    const task = buildEventInstructionIndex(input).then((index) => {
        indexCache.set(key, { fingerprint, index });
        inFlight.delete(key);
        while (indexCache.size > INDEX_CACHE_LIMIT) {
            const oldest = indexCache.keys().next().value;
            if (oldest === undefined)
                break;
            indexCache.delete(oldest);
        }
        return index;
    }).catch((error) => {
        inFlight.delete(key);
        throw error;
    });
    inFlight.set(key, task);
    return task;
}
/** 测试隔离：清掉模块级缓存。 */
export function clearEventInstructionIndexCache() {
    indexCache.clear();
    inFlight.clear();
}
//# sourceMappingURL=eventInstructionIndex.js.map