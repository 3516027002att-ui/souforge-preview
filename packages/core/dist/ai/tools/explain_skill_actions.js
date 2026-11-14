import { formatActionAddress } from '@soulforge/shared';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { asNumber, asOptionalString, asRecord, fail, nativePathFromFileToken, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { resolveWeaponMotionCandidates, WEAPON_MOTION_FIELDS } from '../../param/weaponMotion.js';
import { scanTaeExport } from '../../editing/taeEdit.js';
/**
 * `explain_skill_actions`: turn "which animation does this Combat Art use" into a mechanical
 * candidate set.
 *
 * There is no SkillParam -> animId field. The verifiable chain stops at the dummy weapon the
 * skill fights with: SkillParam.virtualWeaponId -> EquipParamWeapon motion fields -> TAE groups.
 * This tool follows exactly that chain and then reports every action in those groups that carries
 * an Attack Behavior event, with the evidence a human needs to pick one. It never asserts which
 * action *is* the skill: that edge is absent from the data.
 */
const DEFAULT_FILE = 'chr/c0000.anibnd.dcx';
const DEFAULT_LIMIT = 256;
const MAX_LIMIT = 512;
/** Same bound as search_tae_events: a c0000 scan is one large object. */
const SCAN_CACHE_ENTRIES = 2;
const scanCache = new Map();
const sha256Of = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
/** The evidence weights are published with every answer, not hidden in the sort call. */
// 键名带 Weight 后缀：这是一张权重表，不是对某个动作「有没有 760」的断言。
// 同名键会让完整性声明扫描器无法区分证据与常量（has760 是断言，has760Weight 是分值）。
const RANK_WEIGHTS = {
    has760Weight: 100,
    uniqueJudgeWeight: 30,
    noBulletWeight: 20,
    singleJudgeWeight: 10
};
const canonicalName = (value) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const normalizeGroupName = (value) => (value ?? '').replace(/\.tae.*$/iu, '').trim().toLowerCase();
const numericValue = (value) => {
    if (value === undefined)
        return null;
    if (typeof value !== 'string')
        return value;
    const trimmed = value.trim();
    if (trimmed !== '' && Number.isFinite(Number(trimmed)))
        return Number(trimmed);
    return value;
};
function actionUriOf(chrId, animation) {
    return formatActionAddress({
        chr: chrId === '' ? 'c0000' : chrId,
        animId: animation.animId,
        ...(animation.taeEntryIndex === undefined ? {} : { taeEntryIndex: animation.taeEntryIndex }),
        ...(animation.taeEntryIndex === undefined && animation.taeEntryId !== undefined ? { taeEntryId: animation.taeEntryId } : {}),
        ...(animation.taeEntryIndex === undefined && animation.taeEntryId === undefined && animation.taeEntryName !== undefined
            ? { taeEntryName: animation.taeEntryName } : {}),
        ...(animation.taeEntryIndex === undefined && animation.taeEntryId === undefined && animation.taeEntryName === undefined
            && animation.taeGroup !== undefined ? { taeGroup: animation.taeGroup } : {})
    });
}
function eventFieldValue(event, names) {
    return event.fields?.find((field) => names.has(canonicalName(field.name)))?.value;
}
function spEffectIds(event) {
    const ids = [];
    for (const field of event.fields ?? []) {
        if (!canonicalName(field.name).startsWith('speffectid'))
            continue;
        if (!ids.includes(field.value))
            ids.push(field.value);
    }
    return ids;
}
function isAttackBehavior(event) {
    return event.eventTypeId === 1 || canonicalName(event.typeName ?? '').includes('attackbehavior');
}
function isSpEffectEvent(event) {
    return spEffectIds(event).length > 0 || canonicalName(event.typeName ?? '').includes('speffect');
}
function isBulletEvent(event) {
    return canonicalName(event.typeName ?? '').includes('bullet')
        || (event.fields ?? []).some((field) => canonicalName(field.name) === 'bulletid');
}
function summarizeAction(chrId, animation) {
    const events = animation.events;
    const attackBehavior = [];
    const range760 = [];
    const spEffectIdsSeen = [];
    const bulletJudges = [];
    const bulletIds = [];
    let spEffectEventCount = 0;
    let bulletEventCount = 0;
    let decodeIssues = 0;
    for (const event of events) {
        if (event.decodeStatus === 'partial' || event.decodeStatus === 'unknown')
            decodeIssues++;
        if (isAttackBehavior(event)) {
            attackBehavior.push({
                eventIndex: event.index,
                judge: numericValue(eventFieldValue(event, new Set(['behaviorjudgeid'])))
            });
        }
        if (event.eventTypeId === 760) {
            range760.push({
                eventIndex: event.index,
                referenceDistance: numericValue(eventFieldValue(event, new Set(['referencedistance']))),
                enableRangeMinimum: numericValue(eventFieldValue(event, new Set(['enablerangeminimum']))),
                enableRangeMaximum: numericValue(eventFieldValue(event, new Set(['enablerangemaximum'])))
            });
        }
        if (isSpEffectEvent(event)) {
            const ids = spEffectIds(event);
            if (ids.length > 0) {
                spEffectEventCount++;
                for (const id of ids)
                    if (!spEffectIdsSeen.includes(id))
                        spEffectIdsSeen.push(id);
            }
        }
        if (isBulletEvent(event)) {
            bulletEventCount++;
            const judge = numericValue(eventFieldValue(event, new Set(['behaviorjudgeid'])));
            const bulletId = numericValue(eventFieldValue(event, new Set(['bulletid'])));
            if (judge !== null && !bulletJudges.includes(judge))
                bulletJudges.push(judge);
            if (bulletId !== null && !bulletIds.includes(bulletId))
                bulletIds.push(bulletId);
        }
    }
    const judges = [];
    for (const item of attackBehavior) {
        if (item.judge === null || judges.includes(item.judge))
            continue;
        judges.push(item.judge);
    }
    const eventCount = animation.eventCount ?? events.length;
    // 事件尾部没读全时，`range760.length === 0` 只能说明「读到的部分里没有 760」。
    // 以前这里直接写 false，而 false 同时表示「读完了确实没有」和「没读到那儿」——
    // 一个裸布尔替证据说了它没有的话，还带着 +100 的排行权重把候选压到后面。
    const eventsComplete = animation.eventsComplete !== false && events.length === eventCount;
    return {
        actionUri: actionUriOf(chrId, animation),
        animId: animation.animId,
        code: animation.code,
        taeGroup: animation.taeGroup ?? '',
        eventCount,
        eventsComplete,
        attackBehaviorEventCount: attackBehavior.length,
        judges,
        has760: eventsComplete ? range760.length > 0 : null,
        has760Complete: eventsComplete,
        range760,
        spEffectIds: spEffectIdsSeen,
        spEffectEventCount,
        bulletJudges,
        bulletIds,
        bulletEventCount,
        decodeIssues
    };
}
/**
 * has760 的名次优先级：有 760 > 760 未知 > 确认没有。
 *
 * 未知不能排到「确认没有」后面——那正是旧写法的静默错误：尾部没读全的候选被当成
 * 没有 760，直接掉出前面，而排行权重 +100 让它跌得更狠。这里把它放在两者之间，
 * 排序先按这条优先级，再按公开的分数权重。
 */
function has760Priority(candidate) {
    return candidate.has760 === true ? 2 : candidate.has760 === null ? 1 : 0;
}
function rankCandidates(candidates) {
    // "Unique" means the value appears in exactly one action of the resolved candidate set, so a
    // shared behavior row (the common case for locomotion-ish attack events) does not outrank an
    // animation that only this skill can play.
    const judgeActionCounts = new Map();
    for (const candidate of candidates) {
        for (const judge of new Set(candidate.judges.map((value) => JSON.stringify(value)))) {
            judgeActionCounts.set(judge, (judgeActionCounts.get(judge) ?? 0) + 1);
        }
    }
    const judgeUniqueComplete = candidates.every((candidate) => candidate.eventsComplete);
    return candidates
        .map((candidate) => {
        const judgeUnique = candidate.judges.length > 0 && candidate.judges.every((judge) => (judgeActionCounts.get(JSON.stringify(judge)) ?? 0) === 1);
        const rankBy = [];
        let score = 0;
        if (candidate.has760 === true) {
            score += RANK_WEIGHTS.has760Weight;
            rankBy.push('has-760');
        }
        else if (candidate.has760 === null) {
            rankBy.push('has-760-unknown');
        }
        if (judgeUnique) {
            score += RANK_WEIGHTS.uniqueJudgeWeight;
            rankBy.push('unique-judge');
        }
        if (candidate.bulletEventCount === 0) {
            score += RANK_WEIGHTS.noBulletWeight;
            rankBy.push('no-bullet');
        }
        if (candidate.judges.length === 1) {
            score += RANK_WEIGHTS.singleJudgeWeight;
            rankBy.push('single-judge');
        }
        return {
            ...candidate,
            rank: 0,
            score,
            tier: candidate.has760 === true ? 'has-760'
                : candidate.has760 === null ? 'has-760-unknown'
                    : judgeUnique ? 'unique-judge' : 'shared-judge',
            judgeUnique,
            judgeUniqueComplete,
            rankBy
        };
    })
        .sort((left, right) => has760Priority(right) - has760Priority(left)
        || right.score - left.score
        || left.taeGroup.localeCompare(right.taeGroup)
        || left.animId - right.animId)
        .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
/** Scan the container once per unchanged physical file, exactly like search_tae_events. */
async function scanContainerCached(input) {
    const key = `${input.edit.session.meta.workspaceId}\0${input.file}`;
    const before = await sha256Of(input.file).catch(() => undefined);
    if (before !== undefined) {
        const hit = scanCache.get(key);
        if (hit !== undefined && hit.sha256 === before) {
            scanCache.delete(key);
            scanCache.set(key, hit);
            return { ...hit.scan, stats: hit.scan.stats, diagnostics: hit.scan.diagnostics };
        }
    }
    const scan = await scanTaeExport(input);
    if (scan.ok && scan.partial !== true && before !== undefined) {
        const after = await sha256Of(input.file).catch(() => undefined);
        if (after === before) {
            scanCache.delete(key);
            scanCache.set(key, { sha256: before, scan });
            while (scanCache.size > SCAN_CACHE_ENTRIES)
                scanCache.delete(scanCache.keys().next().value);
        }
    }
    return scan;
}
function readFailure(error) {
    return (error instanceof Error ? error : new Error(String(error)));
}
/** explain_skill_actions: one domain tool declaration, schema and handler. */
export function createExplainSkillActionsTool(deps = {}) {
    const readParams = deps.readParamFields ?? readParamFields;
    const scanTae = deps.scanTae ?? scanContainerCached;
    return {
        name: 'explain_skill_actions',
        description: 'Answer "which TAE actions can this skill row use" as an evidence set, without guessing. '
            + 'Resolves SkillParam.virtualWeaponId -> EquipParamWeapon motion fields (wepmotionCategory / wepmotionOneHandId / '
            + 'wepmotionBothHandId / spAtkcategory) -> TAE groups, then scans the container natively and lists every action in '
            + 'those groups that carries an Attack Behavior event. Each candidate reports actionUri, animId, event count, every '
            + 'Behavior Judge ID, whether it contains a 760 (Set Root Motion Multiplier) event with the current Reference '
            + 'Distance / Enable Range Minimum / Enable Range Maximum, and any SpEffect IDs / Bullet judge values. '
            + 'has760 is tri-state: true / false (the event tail was read whole) / null (unknown — has760Complete:false). '
            + 'null must never be read as "no 760", and a null candidate is ranked between the confirmed-yes and the '
            + 'confirmed-no ones instead of being demoted by the +100 weight. Aggregate counts (has760Count, '
            + 'bulletActionCount, spEffectActionCount, uniqueJudgeCount) are {complete, incomplete} so a partial scan '
            + 'cannot report "0" as a proven negative. Candidates '
            + 'are ranked by published weights: has 760 (+100), judge value unique in the candidate set (+30), no Bullet event '
            + '(+20), single judge value (+10), then taeGroup/animId. The output states the ranking basis and never claims which '
            + 'action is the skill: there is no SkillParam -> animId edge in the data. Start from {table:"SkillParam",rowId:100}, '
            + 'or pass weaponId to override the weapon group explicitly (then table/rowId are optional context). '
            + 'file defaults to chr/c0000.anibnd.dcx; the first native scan of a large container can take tens of seconds. '
            + 'Pass animId to check whether that action exists in the resolved groups and where else it appears. '
            + 'If the resolved group does not exist in the container, the call fails with TAE_GROUP_NOT_FOUND and lists the '
            + 'groups the container does have. Read-only.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string?',
            rowId: 'safe-integer?',
            weaponId: 'safe-integer?',
            file: 'string?',
            animId: 'safe-integer?',
            offset: 'safe-integer?',
            limit: 'safe-integer?'
        },
        run: async (input, context) => {
            if (context.workspaceIndex === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const table = asOptionalString(value.table)?.trim();
            const rowId = Number.isSafeInteger(value.rowId) ? Math.trunc(asNumber(value.rowId, Number.NaN)) : undefined;
            const explicitWeaponId = Number.isSafeInteger(value.weaponId) ? Math.trunc(asNumber(value.weaponId, Number.NaN)) : undefined;
            if (explicitWeaponId !== undefined && (explicitWeaponId < 0 || Number.isNaN(explicitWeaponId))) {
                return fail('INVALID_INPUT', 'explain_skill_actions 的 weaponId 必须是非负安全整数。');
            }
            const hasSkillTarget = table !== undefined && table !== '' && rowId !== undefined && !Number.isNaN(rowId);
            if (explicitWeaponId === undefined && !hasSkillTarget) {
                return fail('SKILL_TARGET_REQUIRED', 'explain_skill_actions 需要 {table:"SkillParam",rowId:100}（技能行），或直接给 weaponId 覆盖武器组。');
            }
            if (hasSkillTarget && (rowId === undefined || rowId < 0)) {
                return fail('INVALID_INPUT', 'explain_skill_actions 的 rowId 必须是非负安全整数。');
            }
            const fileToken = asOptionalString(value.file)?.trim() || DEFAULT_FILE;
            const animId = Number.isSafeInteger(value.animId) ? Math.trunc(asNumber(value.animId, Number.NaN)) : undefined;
            if (animId !== undefined && animId < 0) {
                return fail('INVALID_INPUT', 'explain_skill_actions 的 animId 必须是非负安全整数。');
            }
            const offset = Number.isSafeInteger(value.offset) ? Math.max(0, Math.trunc(asNumber(value.offset, 0))) : 0;
            const limit = Number.isSafeInteger(value.limit)
                ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(asNumber(value.limit, DEFAULT_LIMIT))))
                : DEFAULT_LIMIT;
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            // 1. Skill row -> virtualWeaponId (or an explicit weapon override).
            let skill = null;
            let skillError;
            if (hasSkillTarget) {
                try {
                    const skillRead = await readParams({
                        edit: edit.session,
                        queries: [{
                                table: table,
                                rowIds: [rowId],
                                fieldIds: ['virtualWeaponId', 'acquireWeaponId', 'reinforceWeaponId']
                            }]
                    });
                    if (!skillRead.ok) {
                        if (explicitWeaponId === undefined) {
                            const code = skillRead.error.code === 'PARAM_ROW_NOT_FOUND' ? 'SKILL_ROW_NOT_FOUND'
                                : skillRead.error.code === 'PARAM_FIELD_NOT_FOUND' ? 'SKILL_WEAPON_FIELD_NOT_FOUND'
                                    : skillRead.error.code;
                            return fail(code, skillRead.error.message, skillRead.error.details);
                        }
                        skillError = `${skillRead.error.code}: ${skillRead.error.message}`;
                    }
                    else {
                        const cell = (fieldId) => skillRead.fields.find((field) => field.fieldId === fieldId && field.rowId === rowId);
                        const virtual = cell('virtualWeaponId');
                        const acquire = cell('acquireWeaponId');
                        const reinforce = cell('reinforceWeaponId');
                        if (virtual === undefined) {
                            const missingRow = skillRead.missingRows.some((row) => row.rowId === rowId);
                            if (explicitWeaponId === undefined) {
                                return fail(missingRow ? 'SKILL_ROW_NOT_FOUND' : 'SKILL_WEAPON_FIELD_NOT_FOUND', missingRow
                                    ? `PARAM 行 ${table}#${rowId} 不存在。先用 search_param_rows 定位技能行，或直接给 weaponId。`
                                    : `${table}#${rowId} 没有 virtualWeaponId 字段，无法从技能行解析武器；改用 weaponId 指定。`, { table, rowId, missingRows: skillRead.missingRows });
                            }
                            skillError = `${table}#${rowId} 没有 virtualWeaponId 字段。`;
                        }
                        else {
                            const virtualWeaponId = Number(virtual.value);
                            const acquireWeaponId = acquire === undefined ? null : Number(acquire.value);
                            const usable = Number.isSafeInteger(virtualWeaponId) && virtualWeaponId > 0;
                            if (!usable && explicitWeaponId === undefined) {
                                return fail('SKILL_VIRTUAL_WEAPON_UNRESOLVED', `${table}#${rowId} 的 virtualWeaponId=${String(virtual.value)} 不是有效的武器行 id`
                                    + `${acquireWeaponId !== null ? `（acquireWeaponId=${String(acquireWeaponId)}）` : ''}；`
                                    + '直接给 weaponId 可以显式指定要解析的武器组。', {
                                    table, rowId,
                                    virtualWeaponId: virtual.value,
                                    ...(acquireWeaponId === null ? {} : { acquireWeaponId }),
                                    ...(reinforce === undefined ? {} : { reinforceWeaponId: reinforce.value })
                                });
                            }
                            skill = {
                                table: table,
                                rowId: rowId,
                                rowName: virtual.rowName ?? null,
                                virtualWeaponId: usable ? virtualWeaponId : 0,
                                acquireWeaponId: acquireWeaponId !== null && Number.isSafeInteger(acquireWeaponId) ? acquireWeaponId : null,
                                fields: [
                                    {
                                        fieldId: 'virtualWeaponId',
                                        value: virtual.value,
                                        role: 'virtual-weapon',
                                        applied: explicitWeaponId === undefined,
                                        ...(explicitWeaponId === undefined ? {} : { reason: 'weaponId 显式覆盖，本字段只作对照。' })
                                    },
                                    ...(acquire === undefined ? [] : [{
                                            fieldId: 'acquireWeaponId',
                                            value: acquire.value,
                                            role: 'acquired-weapon',
                                            applied: false,
                                            reason: '技能解锁时授予的武器；本工具的动作解析只跟 virtualWeaponId。'
                                        }]),
                                    ...(reinforce === undefined ? [] : [{
                                            fieldId: 'reinforceWeaponId',
                                            value: reinforce.value,
                                            role: 'reinforced-weapon',
                                            applied: false,
                                            reason: '技能解锁时强化的武器；不用于动作解析。'
                                        }])
                                ]
                            };
                        }
                    }
                }
                catch (error) {
                    const wrapped = readFailure(error);
                    if (explicitWeaponId === undefined) {
                        return fail(wrapped.code ?? 'SKILL_READ_FAILED', wrapped.message);
                    }
                    skillError = `${wrapped.code ?? 'SKILL_READ_FAILED'}: ${wrapped.message}`;
                }
            }
            const weaponId = explicitWeaponId ?? skill?.virtualWeaponId;
            if (weaponId === undefined || !Number.isSafeInteger(weaponId)) {
                return fail('SKILL_VIRTUAL_WEAPON_UNRESOLVED', '技能行没有可用的 virtualWeaponId；给 weaponId 显式指定武器组。');
            }
            const overridden = explicitWeaponId !== undefined && skill !== null && skill.virtualWeaponId !== explicitWeaponId;
            // 2. Weapon row -> motion fields -> TAE groups.
            let weaponRead;
            try {
                weaponRead = await readParams({
                    edit: edit.session,
                    queries: [{
                            table: 'EquipParamWeapon',
                            rowIds: [weaponId],
                            fieldIds: WEAPON_MOTION_FIELDS.map((spec) => spec.field)
                        }]
                });
            }
            catch (error) {
                const wrapped = readFailure(error);
                return fail(wrapped.code ?? 'WEAPON_READ_FAILED', wrapped.message);
            }
            if (!weaponRead.ok) {
                if (weaponRead.error.code === 'PARAM_ROW_NOT_FOUND') {
                    return fail('WEAPON_ROW_NOT_FOUND', `EquipParamWeapon#${weaponId} 不存在：技能行指向的武器行无法解析，动作组也不存在。`
                        + '先用 search_param_rows 确认武器行 id，或给 weaponId 指定另一行。', { weaponId, table: 'EquipParamWeapon' });
                }
                return fail(weaponRead.error.code, weaponRead.error.message, weaponRead.error.details);
            }
            const weaponCells = weaponRead.fields;
            if (weaponCells.length === 0 && weaponRead.missingRows.some((row) => row.rowId === weaponId)) {
                return fail('WEAPON_ROW_NOT_FOUND', `EquipParamWeapon#${weaponId} 不存在：技能行指向的武器行无法解析，动作组也不存在。`, { weaponId, table: 'EquipParamWeapon' });
            }
            const motionValues = {};
            for (const spec of WEAPON_MOTION_FIELDS) {
                const cell = weaponCells.find((field) => field.fieldId === spec.field);
                if (cell !== undefined)
                    motionValues[spec.field] = Number(cell.value);
            }
            if (motionValues.wepmotionCategory === undefined) {
                return fail('WEAPON_MOTION_FIELDS_UNAVAILABLE', `EquipParamWeapon#${weaponId} 没有 wepmotionCategory 字段，无法解析动作组。`, { weaponId, table: 'EquipParamWeapon' });
            }
            const resolvedMotion = resolveWeaponMotionCandidates(motionValues);
            if (resolvedMotion.groups.length === 0) {
                return fail('TAE_GROUPS_UNRESOLVED', `EquipParamWeapon#${weaponId} 的全部 motion 字段都没有给出可用的 TAE 组；没有动作组可查。`, { weaponId, motionFields: resolvedMotion.fields });
            }
            const weaponRowName = weaponCells.find((field) => field.rowId === weaponId)?.rowName ?? null;
            const groupNote = resolvedMotion.fields.filter((field) => field.applied)
                .map((field) => `${field.field}=${String(field.value)}→${String(field.taeGroup)}`).join('，');
            const weapon = {
                table: 'EquipParamWeapon',
                rowId: weaponId,
                rowName: weaponRowName,
                motionFields: resolvedMotion.fields,
                taeGroups: resolvedMotion.groups,
                resolvedBy: resolvedMotion.resolvedBy,
                note: `按 EquipParamWeapon 的全部 motion 字段解析动作组：${groupNote || '（没有可用字段）'}。`
                    + '数值 0 的覆盖字段（wepmotionOneHandId / wepmotionBothHandId / spAtkcategory）视为未设置，不映射到 a00；'
                    + 'guardmotionCategory 只决定格挡动画，未用作动作组。'
            };
            // 3. Native scan -> actions grouped by the resolved TAE groups.
            const resolvedFile = resolveIndexedResourceFile(context, fileToken, 'chr');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const nativePath = nativePathFromFileToken(resolvedFile.path);
            let scan;
            try {
                scan = await scanTae({
                    edit: edit.session,
                    file: nativePath,
                    sourceUri: resolvedFile.canonical === true ? resolvedFile.sourceUri : pathToFileURL(nativePath).href,
                    ...(context.signal === undefined ? {} : { signal: context.signal }),
                    ...(context.onDiagnostic === undefined ? {} : {
                        onPage: (progress) => context.onDiagnostic?.({ phase: 'tae-native-scan', status: 'progress', details: progress })
                    })
                });
            }
            catch (error) {
                const wrapped = readFailure(error);
                return fail(wrapped.code ?? 'TAE_SCAN_FAILED', wrapped.message);
            }
            if (!scan.ok)
                return fail(scan.error.code, scan.error.message, scan.diagnostics);
            const groupSet = new Set(resolvedMotion.groups);
            const groupOfAction = (animation) => normalizeGroupName(animation.taeGroup ?? animation.taeEntryName);
            const entryGroups = new Set((scan.export.taeEntries ?? []).map((entry) => normalizeGroupName(entry.taeGroup || entry.entryName)));
            const actionsByGroup = new Map();
            for (const group of groupSet)
                actionsByGroup.set(group, []);
            for (const animation of scan.export.animations) {
                const group = groupOfAction(animation);
                if (!groupSet.has(group))
                    continue;
                actionsByGroup.get(group).push(animation);
            }
            const presentGroups = resolvedMotion.groups.filter((group) => (actionsByGroup.get(group)?.length ?? 0) > 0 || entryGroups.has(group));
            const missingGroups = resolvedMotion.groups.filter((group) => !presentGroups.includes(group));
            if (presentGroups.length === 0) {
                const availableGroups = [...new Set([
                        ...entryGroups,
                        ...scan.export.animations.map((animation) => groupOfAction(animation))
                    ])].filter((group) => group !== '').sort();
                return fail('TAE_GROUP_NOT_FOUND', `解析出的动作组 ${resolvedMotion.groups.join('、')} 不在 ${fileToken} 里。`
                    + `该容器现有的动作组：${availableGroups.slice(0, 40).join('、')}${availableGroups.length > 40 ? '…' : ''}。`, {
                    requestedGroups: resolvedMotion.groups,
                    availableGroups,
                    file: fileToken,
                    weaponId,
                    taeEntryCount: scan.export.taeEntries?.length ?? null
                });
            }
            const chrId = scan.export.chrId;
            const groupInventory = resolvedMotion.groups.map((group) => {
                const actions = actionsByGroup.get(group) ?? [];
                const candidates = actions.filter((animation) => animation.events.some(isAttackBehavior));
                const resolvedBy = resolvedMotion.fields
                    .filter((field) => field.applied && normalizeGroupName(field.taeGroup) === group)
                    .map((field) => field.field);
                return {
                    taeGroup: group,
                    resolvedBy,
                    actionCount: actions.length,
                    attackActionCount: candidates.length,
                    actionsWithoutAttackBehaviorCount: actions.length - candidates.length,
                    actionCodes: actions.map((animation) => animation.code)
                };
            });
            const candidatesBase = (actionsByGroup.get(resolvedMotion.groups[0]) ?? [])
                .filter((animation) => animation.events.some(isAttackBehavior))
                .map((animation) => summarizeAction(chrId, animation));
            // Multi-group weapons (category 50 + one-hand override 10) keep one candidate set; the
            // group of each candidate is in the record, so ranking still compares like with like.
            if (resolvedMotion.groups.length > 1) {
                for (const group of resolvedMotion.groups.slice(1)) {
                    for (const animation of actionsByGroup.get(group) ?? []) {
                        if (animation.events.some(isAttackBehavior)) {
                            candidatesBase.push(summarizeAction(chrId, animation));
                        }
                    }
                }
            }
            const ranked = rankCandidates(candidatesBase);
            const page = ranked.slice(offset, offset + limit);
            // 聚合计数不得单独出现：一个裸数字「0 个动作有 760」在被截断的扫描里读起来
            // 就是「一个都没有」，而它可能只是「没读到」。complete = 已确认满足；
            // incomplete = 事件没读全、无法判定的那部分。partial 扫描时 incomplete > 0。
            const observedCountByCompleteness = (items, isComplete, matches) => {
                let complete = 0;
                let incomplete = 0;
                for (const item of items) {
                    if (!isComplete(item)) {
                        incomplete++;
                        continue;
                    }
                    if (matches(item))
                        complete++;
                }
                return { complete, incomplete };
            };
            const summary = {
                groupCount: groupInventory.length,
                actionCount: groupInventory.reduce((total, group) => total + group.actionCount, 0),
                candidateCount: ranked.length,
                returnedCount: page.length,
                has760Count: observedCountByCompleteness(ranked, (c) => c.eventsComplete, (c) => c.has760 === true),
                uniqueJudgeCount: observedCountByCompleteness(ranked, (c) => c.eventsComplete, (c) => c.judgeUnique),
                bulletActionCount: observedCountByCompleteness(ranked, (c) => c.eventsComplete, (c) => c.bulletEventCount > 0),
                spEffectActionCount: observedCountByCompleteness(ranked, (c) => c.eventsComplete, (c) => c.spEffectEventCount > 0),
                /** 计数口径：complete 已判定，incomplete 事件未读全、状态未知（不是「没有」）。 */
                countSemantics: 'complete = 已判定并满足；incomplete = 事件未读全、无法判定（不得读成「没有」）。',
                groups: groupInventory.map((group) => ({
                    taeGroup: group.taeGroup,
                    actionCount: group.actionCount,
                    candidateCount: group.attackActionCount
                }))
            };
            let lookup;
            if (animId !== undefined) {
                const matches = scan.export.animations
                    .filter((animation) => animation.animId === animId)
                    .map((animation) => {
                    const eventCount = animation.eventCount ?? animation.events.length;
                    const complete = animation.eventsComplete !== false && animation.events.length === eventCount;
                    return {
                        actionUri: actionUriOf(chrId, animation),
                        taeGroup: groupOfAction(animation),
                        ...(animation.taeEntryIndex === undefined ? {} : { taeEntryIndex: animation.taeEntryIndex }),
                        eventCount,
                        hasAttackBehavior: animation.events.some(isAttackBehavior),
                        // 同一个否定陷阱：没读全时只能给 null，不能给「没有」。
                        has760: complete ? animation.events.some((event) => event.eventTypeId === 760) : null,
                        has760Complete: complete
                    };
                });
                lookup = {
                    animId,
                    presentInResolvedGroups: matches.some((match) => groupSet.has(match.taeGroup)),
                    presentInContainer: matches.length > 0,
                    matches,
                    note: matches.length === 0
                        ? `animId=${animId} 在 ${fileToken} 里没有动作。`
                        : matches.some((match) => groupSet.has(match.taeGroup))
                            ? `animId=${animId} 出现在解析出的动作组里。`
                            : `animId=${animId} 在容器里的其它动作组（${[...new Set(matches.map((match) => match.taeGroup))].join('、')}）中，不在解析出的组 ${resolvedMotion.groups.join('、')} 里。`
                };
            }
            const chain = [];
            if (skill !== null) {
                chain.push(`${skill.table}#${skill.rowId}${skill.rowName === null ? '' : `「${skill.rowName}」`}`
                    + `.virtualWeaponId=${String(skill.virtualWeaponId)}`);
            }
            chain.push(`EquipParamWeapon#${weaponId}${weapon.rowName === null ? '' : `「${weapon.rowName}」`}.`
                + resolvedMotion.fields.filter((field) => field.applied)
                    .map((field) => `${field.field}=${String(field.value)}→${String(field.taeGroup)}`).join('，'));
            chain.push(`taeGroups=[${resolvedMotion.groups.join('，')}] → ${fileToken}`);
            const note = [
                overridden
                    ? `weaponId=${explicitWeaponId} 覆盖了技能行的 virtualWeaponId=${skill?.virtualWeaponId ?? '?'}；技能行仍列在 resolution.skill 里作对照。`
                    : '',
                skillError === undefined ? '' : `技能行读取失败（已按显式 weaponId 继续）：${skillError}`,
                missingGroups.length > 0
                    ? `动作组 ${missingGroups.join('、')} 不在容器里；只返回存在组 ${presentGroups.join('、')} 的候选。`
                    : '',
                ranked.length === 0
                    ? `动作组 ${presentGroups.join('、')} 里没有含 Attack Behavior 事件的动作，因此候选集为空。`
                    : '',
                scan.partial === true
                    ? `本次为部分扫描：${scan.incompleteActionCount ?? (scan.incompleteActions ?? []).length} 个动作没有完整读出；这些候选的 has760=null、eventsComplete=false、judgeUniqueComplete=false —— 表示「状态未知」，不是「没有」。`
                    : '',
                ranked.some((candidate) => candidate.has760 === null)
                    ? `有 ${ranked.filter((candidate) => candidate.has760 === null).length} 个候选的事件尾部没读全：has760=null 表示 760 状态未知（has760Complete=false），不得读成「没有 760」，它们也不会被排行权重压到确认没有的候选后面。`
                    : '',
                '候选集只给证据：数据里没有 SkillParam → animId 字段，也没有“这个候选就是该技能”的边；'
                    + '请按 judges、has760/range760、bulletJudges/bulletIds、judgeUnique 自己判断。'
            ].filter(Boolean).join(' ');
            const nextActions = [];
            if (offset + limit < ranked.length) {
                nextActions.push({
                    tool: 'explain_skill_actions',
                    args: {
                        ...value,
                        offset: offset + limit,
                        limit
                    },
                    reason: '继续读取候选集的后半段；动作组解析与扫描结果不变。'
                });
            }
            if (page[0] !== undefined) {
                nextActions.push({
                    tool: 'read_tae_events',
                    args: { file: fileToken, addresses: [page[0].actionUri] },
                    reason: '用原生读回该候选动作的全部事件（rank 1 只是按公开权重排序，不是判定）。'
                });
            }
            return ok({
                file: fileToken,
                coverage: scan.partial === true ? 'native-scan-partial' : 'native-scan',
                scan: {
                    ...scan.stats,
                    ...(scan.export.outerFileHash === undefined ? {} : { outerFileHash: scan.export.outerFileHash }),
                    ...(scan.export.sourceHash === undefined ? {} : { sourceHash: scan.export.sourceHash }),
                    ...(scan.partial === true ? {
                        partial: true,
                        incompleteActionCount: scan.incompleteActionCount ?? (scan.incompleteActions ?? []).length
                    } : {})
                },
                resolution: {
                    chain,
                    skill,
                    weapon,
                    taeGroups: resolvedMotion.groups,
                    resolvedBy: resolvedMotion.resolvedBy,
                    overridden
                },
                groups: groupInventory,
                summary,
                rankingBasis: [
                    { signal: 'has760', weight: RANK_WEIGHTS.has760Weight, reason: '含 760（Set Root Motion Multiplier）事件的动作排在前面。760 状态未知（has760=null，事件尾部没读全）的候选排在「确认有」与「确认没有」之间，不会被当成没有 760 而沉底。' },
                    { signal: 'uniqueJudge', weight: RANK_WEIGHTS.uniqueJudgeWeight, reason: 'Attack Behavior 的判定值在整个候选集里只出现一次的动作排在前面。' },
                    { signal: 'noBullet', weight: RANK_WEIGHTS.noBulletWeight, reason: '不含 Bullet 事件的动作排在前面。' },
                    { signal: 'singleJudge', weight: RANK_WEIGHTS.singleJudgeWeight, reason: '只有一个判定值的动作排在前面。' },
                    { signal: 'tieBreak', weight: 0, reason: '同分按 taeGroup、animId 升序。' }
                ],
                selectionGuide: [
                    { field: 'actionUri', why: '候选动作的精确地址；用 read_tae_events 精读它，组里没有的地址就是没有。' },
                    { field: 'judges / attackBehaviorEventCount', why: 'Attack Behavior 的 Behavior Judge ID 去重列表与事件数；它把动作连到 BehaviorParam 行。' },
                    { field: 'judgeUnique', why: '该判定值是否在整个候选集里只出现一次（更像独立招式，但仍不是判定）。' },
                    { field: 'has760 / range760', why: '是否含 760 事件，以及当前的 Reference Distance / Enable Range Maximum；has760=null 表示事件尾部没读全、状态未知（has760Complete=false），不得读成「没有 760」。只有含 760 的动作才有 range760 值。' },
                    { field: 'bulletJudges / bulletIds / bulletEventCount', why: 'Bullet 事件的判定值、Bullet ID 与事件数；有子弹边通常意味着远程或投射物。' },
                    { field: 'spEffectIds / spEffectEventCount', why: '动作里添加的 SpEffect ID 与事件数。' },
                    { field: 'eventCount / eventsComplete', why: '动作的事件总数，以及扫描是否完整读出。' }
                ],
                candidates: page,
                offset,
                limit,
                totalCandidateCount: ranked.length,
                returnedCount: page.length,
                truncated: offset + page.length < ranked.length,
                ...(lookup === undefined ? {} : { lookup }),
                note,
                nextActions
            });
        }
    };
}
//# sourceMappingURL=explain_skill_actions.js.map