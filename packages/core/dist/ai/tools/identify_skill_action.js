import { formatActionAddress, parseActionAddress } from '@soulforge/shared';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { asNumber, asOptionalString, asRecord, fail, nativePathFromFileToken, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { resolveWeaponMotionCandidates, WEAPON_MOTION_FIELDS } from '../../param/weaponMotion.js';
import { scanTaeExport } from '../../editing/taeEdit.js';
/**
 * `identify_skill_action`: answer "which action is this attack" with ids, or say which hop is missing.
 *
 * The chain this tool follows is entirely id-level:
 *
 *   TAE Attack Behavior event.BehaviorJudgeId = J
 *     -> BehaviorParam_PC row (105,000,000 + J), verified by its own behaviorJudgeId field
 *     -> BehaviorParam_PC.refType = 0 (AtkParam) and refId = AtkParam row id
 *     -> AtkParam_Pc row (its native rowName is a label, never a matching criterion)
 *
 * The reverse direction is the same chain read backwards: an AtkParam row -> BehaviorParam refId
 * -> behaviorJudgeId -> every TAE action carrying that judge. When that set has one member the
 * answer is `identified`; when it has several the answer is `not-identified` and lists them all.
 *
 * What this tool deliberately does NOT do:
 * - It never matches by name, rowName similarity, animId == weaponId coincidence, 760 presence,
 *   or ranking. Those are labels/heuristics, not edges.
 * - SkillParam has no AtkParam/animId field. `virtualWeaponId` only narrows the TAE family, so a
 *   bare SkillParam query stays `not-identified` and names the missing hop. Pass atkParamRowId to
 *   combine the skill's family with an attack row that was looked up by id.
 */
const DEFAULT_FILE = 'chr/c0000.anibnd.dcx';
const DEFAULT_ATK_TABLE = 'AtkParam_Pc';
const BEHAVIOR_TABLE = 'BehaviorParam_PC';
/** Observed and verified rule: BehaviorParam_PC row id = 105,000,000 + behaviorJudgeId. */
const BEHAVIOR_ROW_BASE = 105_000_000;
/** Observed and verified rule: BehaviorParam_PC.refId = 5,000,000 + behaviorJudgeId. */
const ATK_ROW_BASE = 5_000_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_ELSEWHERE = 50;
const SCAN_CACHE_ENTRIES = 2;
const scanCache = new Map();
const sha256Of = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const canonicalFieldName = (value) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const normalizeGroupName = (value) => (value ?? '').replace(/\.tae.*$/iu, '').trim().toLowerCase();
function actionUriOf(chrId, animation) {
    return formatActionAddress({
        chr: chrId === '' ? 'c0000' : chrId,
        animId: animation.animId,
        ...(animation.taeEntryIndex === undefined ? {} : { taeEntryIndex: animation.taeEntryIndex }),
        ...(animation.taeEntryIndex === undefined && animation.taeEntryId !== undefined ? { taeEntryId: animation.taeEntryId } : {}),
        ...(animation.taeEntryIndex === undefined && animation.taeEntryId === undefined && animation.taeEntryName !== undefined
            ? { taeEntryName: animation.taeEntryName } : {})
    });
}
/** Behavior Judge ID is the only field that joins a TAE event to BehaviorParam. */
function behaviorJudgeOf(event) {
    return event.fields?.find((field) => canonicalFieldName(field.name) === 'behaviorjudgeid')?.value;
}
function isAttackBehavior(event) {
    return event.eventTypeId === 1 || canonicalFieldName(event.typeName ?? '').includes('attackbehavior');
}
function summarizeAction(chrId, animation) {
    const attacks = [];
    const judges = [];
    for (const event of animation.events ?? []) {
        if (!isAttackBehavior(event))
            continue;
        const judge = behaviorJudgeOf(event);
        if (judge === undefined)
            continue;
        attacks.push({ eventIndex: event.index, judge });
        if (!judges.some((seen) => JSON.stringify(seen) === JSON.stringify(judge)))
            judges.push(judge);
    }
    const eventCount = animation.eventCount ?? (animation.events ?? []).length;
    return {
        actionUri: actionUriOf(chrId, animation),
        animId: animation.animId,
        code: animation.code,
        taeGroup: animation.taeGroup ?? '',
        ...(animation.taeEntryIndex === undefined ? {} : { taeEntryIndex: animation.taeEntryIndex }),
        ...(animation.taeEntryId === undefined ? {} : { taeEntryId: animation.taeEntryId }),
        ...(animation.taeEntryName === undefined ? {} : { taeEntryName: animation.taeEntryName }),
        eventCount,
        eventsComplete: animation.eventsComplete !== false && (animation.events ?? []).length === eventCount,
        judges,
        attacks
    };
}
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
/** One native read for one table; rowName comes from the row itself, never from the query. */
async function readRows(reader, edit, table, rowIds, fieldIds) {
    const rows = new Map();
    const missing = new Set();
    const unique = [...new Set(rowIds.filter((rowId) => Number.isSafeInteger(rowId) && rowId >= 0))];
    if (unique.length === 0)
        return { rows, missing };
    let result;
    try {
        result = await reader({ edit, queries: [{ table, rowIds: unique, fieldIds }] });
    }
    catch (error) {
        // A read where every requested row is absent is a negative fact, not a tool failure:
        // the caller needs "this row does not exist" to name the broken hop.
        const wrapped = error;
        if (wrapped.code === 'PARAM_ROW_NOT_FOUND') {
            for (const rowId of unique)
                missing.add(rowId);
            return { rows, missing };
        }
        throw error;
    }
    if (!result.ok) {
        if (result.error.code === 'PARAM_ROW_NOT_FOUND') {
            for (const rowId of unique)
                missing.add(rowId);
            return { rows, missing };
        }
        throw Object.assign(new Error(result.error.message), { code: result.error.code });
    }
    for (const cell of result.fields) {
        const row = rows.get(cell.rowId) ?? { values: new Map() };
        if (cell.rowName !== undefined)
            row.rowName = cell.rowName;
        row.values.set(cell.fieldId, cell.value);
        rows.set(cell.rowId, row);
    }
    for (const row of result.missingRows) {
        if (row.table === table)
            missing.add(row.rowId);
    }
    // A row that exists but lacks every requested field is still an existing row; only the
    // missingRows list proves absence.
    for (const rowId of unique)
        if (!rows.has(rowId) && !missing.has(rowId))
            missing.add(rowId);
    return { rows, missing };
}
/**
 * Resolve one judge through BehaviorParam_PC to its AtkParam row.
 *
 * The row id is computed from the published rule, but the rule is not the proof: the row is only
 * accepted when its own behaviorJudgeId, refType and refId agree with the judge and the attack row.
 */
async function resolveJudge(reader, edit, judge, atkParamTable) {
    const behaviorParamRowId = BEHAVIOR_ROW_BASE + judge;
    const atkParamRowId = ATK_ROW_BASE + judge;
    const behavior = await readRows(reader, edit, BEHAVIOR_TABLE, [behaviorParamRowId], ['behaviorJudgeId', 'variationId', 'refType', 'refId']);
    const row = behavior.rows.get(behaviorParamRowId);
    const base = {
        judge,
        behaviorTable: BEHAVIOR_TABLE,
        behaviorParamRowId,
        behaviorJudgeId: judge,
        variationId: null,
        refType: -1,
        refId: -1,
        atkParamTable,
        atkParamRowId,
        atkParamRowName: null,
        atkParamExists: false,
        verified: false
    };
    if (row === undefined)
        return { ...base, failure: 'BEHAVIOR_PARAM_ROW_MISSING' };
    const behaviorJudgeId = Number(row.values.get('behaviorJudgeId'));
    const refType = Number(row.values.get('refType'));
    const refId = Number(row.values.get('refId'));
    const variationId = Number(row.values.get('variationId'));
    const next = {
        ...base,
        behaviorJudgeId: Number.isFinite(behaviorJudgeId) ? behaviorJudgeId : judge,
        variationId: Number.isFinite(variationId) ? variationId : null,
        refType: Number.isFinite(refType) ? refType : -1,
        refId: Number.isFinite(refId) ? refId : -1
    };
    if (next.behaviorJudgeId !== judge || next.refType !== 0 || next.refId !== atkParamRowId) {
        return { ...next, failure: 'BEHAVIOR_PARAM_REF_MISMATCH' };
    }
    // The refType=0 edge names AtkParam, but the row itself must exist; a refId without a row is a
    // broken hop, not an attack identity.
    const atk = await readRows(reader, edit, atkParamTable, [atkParamRowId], ['atkType']);
    const atkRow = atk.rows.get(atkParamRowId);
    if (atkRow === undefined)
        return { ...next, failure: 'ATK_PARAM_ROW_MISSING' };
    return {
        ...next,
        atkParamRowName: atkRow.rowName ?? null,
        atkParamExists: true,
        verified: true
    };
}
/** identify_skill_action: one domain tool declaration, schema and handler. */
export function createIdentifySkillActionTool(deps = {}) {
    const readParams = deps.readParamFields ?? readParamFields;
    const scanTae = deps.scanTae ?? scanContainerCached;
    return {
        name: 'identify_skill_action',
        description: 'Decide which TAE action an attack is, using only id-level edges, or say exactly which hop is missing. '
            + 'Targets: {atkParamRowId} (reverse from an AtkParam row), {action} (forward from an action URI), '
            + '{table:"SkillParam",rowId} (skill -> virtualWeaponId -> TAE group), {weaponId} (weapon -> TAE group). '
            + 'The chain is: TAE Attack Behavior event Behavior Judge ID J -> BehaviorParam_PC row 105000000+J, accepted only '
            + 'when its own behaviorJudgeId == J and refType == 0 and refId == 5000000+J -> AtkParam_Pc row 5000000+J, accepted '
            + 'only when that row exists. Reverse direction: an AtkParam row is resolved to its BehaviorParam row by refId, then '
            + 'to every action whose Attack Behavior event carries that judge. '
            + 'verdict:"identified" means exactly one action in scope is reached by that verified chain and identifiedAction '
            + 'carries the action URI plus behaviorParamRowId and atkParamRowId; every other outcome is '
            + 'verdict:"not-identified" with blockedAt naming the hop that failed and the candidates that were reached. '
            + 'SkillParam has no AtkParam or animId field, and EquipParamWeapon only narrows the TAE family (wepmotionCategory); '
            + 'a bare skill/weapon query therefore stays not-identified unless an atkParamRowId is supplied. '
            + 'The implemented chain is the player one (BehaviorParam_PC + AtkParam_Pc); NPC containers use BehaviorParam + '
            + 'AtkParam_Npc and are not wired yet, so their rows read as missing instead of being guessed. '
            + 'Native rowName values are reported as labels only; they are never used to match. Names, animId==weaponId '
            + 'coincidence, 760 presence and ranking are explicitly not evidence. '
            + 'candidates are paged (offset/limit, default 20) so a 65-candidate skill answer keeps its verdict; the page '
            + 'carries totalCandidateCount and nextActions. '
            + 'file defaults to chr/c0000.anibnd.dcx; the first native scan of a large container can take tens of seconds. '
            + 'Read-only.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string?',
            rowId: 'safe-integer?',
            weaponId: 'safe-integer?',
            action: 'string?',
            atkParamRowId: 'safe-integer?',
            atkParamTable: 'string?',
            file: 'string?',
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
            const atkParamRowId = Number.isSafeInteger(value.atkParamRowId)
                ? Math.trunc(asNumber(value.atkParamRowId, Number.NaN)) : undefined;
            const atkParamTable = asOptionalString(value.atkParamTable)?.trim() || DEFAULT_ATK_TABLE;
            const actionText = asOptionalString(value.action)?.trim();
            const fileToken = asOptionalString(value.file)?.trim() || DEFAULT_FILE;
            const offset = Number.isSafeInteger(value.offset) ? Math.max(0, Math.trunc(asNumber(value.offset, 0))) : 0;
            const limit = Number.isSafeInteger(value.limit)
                ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(asNumber(value.limit, DEFAULT_LIMIT))))
                : DEFAULT_LIMIT;
            const hasSkillTarget = table !== undefined && table !== '' && rowId !== undefined && !Number.isNaN(rowId);
            if (!hasSkillTarget && explicitWeaponId === undefined && atkParamRowId === undefined && !actionText) {
                return fail('TARGET_REQUIRED', 'identify_skill_action 需要四种目标之一：{table:"SkillParam",rowId}、{weaponId}、{action:"action://c0000/tae/9/A410000"}、'
                    + '{atkParamRowId:5000100}。可以组合：skill/weapon + atkParamRowId 会把技能的动作组和攻击行一起判定。');
            }
            if (hasSkillTarget && table !== 'SkillParam') {
                return fail('INVALID_INPUT', 'identify_skill_action 的 table 目前只接受 "SkillParam"；武器用 weaponId，动作地址用 action。');
            }
            if (explicitWeaponId !== undefined && (explicitWeaponId < 0 || Number.isNaN(explicitWeaponId))) {
                return fail('INVALID_INPUT', 'identify_skill_action 的 weaponId 必须是非负安全整数。');
            }
            if (atkParamRowId !== undefined && atkParamRowId < 0) {
                return fail('INVALID_INPUT', 'identify_skill_action 的 atkParamRowId 必须是非负安全整数。');
            }
            if (hasSkillTarget && (rowId === undefined || rowId < 0)) {
                return fail('INVALID_INPUT', 'identify_skill_action 的 rowId 必须是非负安全整数。');
            }
            let parsedAction = null;
            if (actionText !== undefined) {
                parsedAction = parseActionAddress(actionText);
                if (parsedAction === null || parsedAction.animId === undefined) {
                    return fail('INVALID_INPUT', `identify_skill_action 的 action 必须是动作地址（例如 action://c0000/tae/9/A410000）；收到 "${actionText}"。`);
                }
            }
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const evidence = [];
            const notes = [];
            const criteria = [
                { rule: 'judge-to-behavior', text: 'TAE Attack Behavior 的 Behavior Judge ID J 必须落到 BehaviorParam_PC 行 105000000+J，且该行自身的 behaviorJudgeId 字段等于 J。' },
                { rule: 'behavior-to-atkparam', text: 'BehaviorParam_PC.refType 必须为 0（AtkParam），refId 必须等于 AtkParam 行 id（5000000+J），且该 AtkParam 行真实存在。' },
                { rule: 'atkparam-to-action', text: 'AtkParam 行只能通过 BehaviorParam_PC.refId 反查到 judge，再反查到携带该 judge 的 Attack Behavior 动作。' },
                { rule: 'not-evidence', text: 'rowName 只是标签；名称相似、animId 与 weaponId 数值相同、含 760、排行权重都不作为判定依据。' },
                { rule: 'single-action', text: '只有候选集恰好剩 1 个动作时才是 identified；多个或 0 个都必须是 not-identified。' }
            ];
            // ---- 1. Native scan: every action, deduped by action URI. -------------------------
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
                const wrapped = error instanceof Error ? error : new Error(String(error));
                return fail(wrapped.code ?? 'TAE_SCAN_FAILED', wrapped.message);
            }
            if (!scan.ok)
                return fail(scan.error.code, scan.error.message, scan.diagnostics);
            const chrId = scan.export.chrId;
            const actions = [];
            const seenActionUris = new Set();
            for (const animation of scan.export.animations) {
                const record = summarizeAction(chrId, animation);
                if (seenActionUris.has(record.actionUri))
                    continue;
                seenActionUris.add(record.actionUri);
                actions.push(record);
            }
            if (scan.partial === true) {
                notes.push(`本次为部分扫描：${scan.incompleteActionCount ?? (scan.incompleteActions ?? []).length} 个动作的事件尾部没读全；`
                    + '这些动作可能漏掉 judge，未命中不等于不存在。');
            }
            // ---- 2. Resolve the scope: action / skill / weapon / whole container. -------------
            let scopeLabel = 'whole-container';
            let scopeActionUris = null; // null = every action in the container
            let skill = null;
            let weapon = null;
            if (actionText !== undefined && parsedAction !== null && parsedAction.animId !== undefined) {
                const wanted = actions.filter((candidate) => candidate.animId === parsedAction.animId
                    && (parsedAction.taeEntryIndex === undefined || candidate.taeEntryIndex === parsedAction.taeEntryIndex));
                if (wanted.length === 0) {
                    return ok({
                        verdict: 'not-identified',
                        target: { kind: 'action', action: actionText },
                        blockedAt: 'ACTION_NOT_IN_CONTAINER',
                        blockedMessage: `${actionText} 在 ${fileToken} 里没有对应动作；容器里有 ${actions.length} 个动作。`,
                        criteria,
                        notes
                    });
                }
                if (wanted.length > 1) {
                    notes.push(`${actionText} 命中 ${wanted.length} 个动作（同一 animId 出现在多个 TAE 段）；候选全部列出，不替调用方选。`);
                }
                scopeActionUris = new Set(wanted.map((candidate) => candidate.actionUri));
                scopeLabel = 'action';
                evidence.push({
                    hop: 'action-address',
                    actionUri: wanted[0].actionUri,
                    animId: wanted[0].animId,
                    taeEntryIndex: wanted[0].taeEntryIndex ?? null,
                    taeGroup: wanted[0].taeGroup
                });
            }
            if (hasSkillTarget) {
                try {
                    const skillRead = await readRows(readParams, edit.session, 'SkillParam', [rowId], ['virtualWeaponId']);
                    const row = skillRead.rows.get(rowId);
                    const virtualWeaponId = row === undefined ? Number.NaN : Number(row.values.get('virtualWeaponId'));
                    if (row === undefined || !Number.isSafeInteger(virtualWeaponId) || virtualWeaponId <= 0) {
                        return ok({
                            verdict: 'not-identified',
                            target: { kind: 'skill', table, rowId, rowName: row?.rowName ?? null },
                            blockedAt: 'SKILL_ROW_UNRESOLVED',
                            blockedMessage: row === undefined
                                ? `SkillParam#${rowId} 不存在；无法解析 virtualWeaponId。`
                                : `SkillParam#${rowId} 的 virtualWeaponId=${String(row.values.get('virtualWeaponId'))} 不是可用的武器行 id。`,
                            criteria,
                            notes
                        });
                    }
                    skill = { table: table, rowId: rowId, rowName: row.rowName ?? null, virtualWeaponId };
                    evidence.push({
                        hop: 'skill-row',
                        table: 'SkillParam',
                        rowId: rowId,
                        rowName: skill.rowName,
                        field: 'virtualWeaponId',
                        value: virtualWeaponId
                    });
                }
                catch (error) {
                    const wrapped = error;
                    return fail(wrapped.code ?? 'SKILL_READ_FAILED', wrapped.message);
                }
            }
            const weaponId = explicitWeaponId ?? skill?.virtualWeaponId;
            if (weaponId !== undefined) {
                try {
                    const weaponRead = await readRows(readParams, edit.session, 'EquipParamWeapon', [weaponId], [...WEAPON_MOTION_FIELDS.map((spec) => spec.field), 'behaviorVariationId']);
                    const row = weaponRead.rows.get(weaponId);
                    if (row === undefined) {
                        return ok({
                            verdict: 'not-identified',
                            target: { kind: 'weapon', weaponId, skill },
                            blockedAt: 'WEAPON_ROW_UNRESOLVED',
                            blockedMessage: `EquipParamWeapon#${weaponId} 不存在；动作组无法解析。`,
                            criteria,
                            notes
                        });
                    }
                    const motionValues = {};
                    for (const spec of WEAPON_MOTION_FIELDS) {
                        const cell = row.values.get(spec.field);
                        if (cell !== undefined)
                            motionValues[spec.field] = Number(cell);
                    }
                    const resolved = resolveWeaponMotionCandidates(motionValues);
                    const variationCell = row.values.get('behaviorVariationId');
                    const behaviorVariationId = variationCell === undefined ? null : Number(variationCell);
                    weapon = {
                        rowId: weaponId,
                        rowName: row.rowName ?? null,
                        taeGroups: resolved.groups,
                        motionFields: resolved.fields,
                        behaviorVariationId: Number.isFinite(behaviorVariationId) ? behaviorVariationId : null
                    };
                    if (resolved.groups.length === 0) {
                        return ok({
                            verdict: 'not-identified',
                            target: { kind: skill === null ? 'weapon' : 'skill', skill, weapon },
                            blockedAt: 'TAE_GROUP_UNRESOLVED',
                            blockedMessage: `EquipParamWeapon#${weaponId} 的 motion 字段没有给出可用 TAE 组。`,
                            criteria,
                            notes
                        });
                    }
                    evidence.push({
                        hop: 'weapon-row',
                        table: 'EquipParamWeapon',
                        rowId: weaponId,
                        rowName: weapon.rowName,
                        field: 'wepmotionCategory',
                        value: resolved.fields.find((field) => field.field === 'wepmotionCategory')?.value ?? null,
                        taeGroups: resolved.groups.join(',')
                    });
                    const groupSet = new Set(resolved.groups.map(normalizeGroupName));
                    const inGroup = actions.filter((candidate) => groupSet.has(normalizeGroupName(candidate.taeGroup)));
                    if (inGroup.length === 0) {
                        return ok({
                            verdict: 'not-identified',
                            target: { kind: skill === null ? 'weapon' : 'skill', skill, weapon },
                            blockedAt: 'TAE_GROUP_UNRESOLVED',
                            blockedMessage: `动作组 ${resolved.groups.join('、')} 在 ${fileToken} 里没有动作。`,
                            criteria,
                            notes
                        });
                    }
                    scopeActionUris = new Set(inGroup.map((candidate) => candidate.actionUri));
                    scopeLabel = skill === null ? 'weapon-group' : 'skill-group';
                }
                catch (error) {
                    const wrapped = error;
                    return fail(wrapped.code ?? 'WEAPON_READ_FAILED', wrapped.message);
                }
            }
            // ---- 3. Optional AtkParam target: verify the leaf row and its BehaviorParam edge. --
            let targetAttack = null;
            if (atkParamRowId !== undefined) {
                const atkRow = await readRows(readParams, edit.session, atkParamTable, [atkParamRowId], ['atkType']);
                const exists = atkRow.rows.has(atkParamRowId);
                const rowName = atkRow.rows.get(atkParamRowId)?.rowName ?? null;
                const judge = atkParamRowId - ATK_ROW_BASE;
                if (!exists) {
                    evidence.push({ hop: 'atk-param', table: atkParamTable, rowId: atkParamRowId, exists: false });
                    return ok({
                        verdict: 'not-identified',
                        target: { kind: 'atk-param', table: atkParamTable, rowId: atkParamRowId, rowName, skill, weapon },
                        blockedAt: 'ATK_PARAM_ROW_MISSING',
                        blockedMessage: `${atkParamTable}#${atkParamRowId} 不存在；攻击行本身没有身份，不能反查动作。`,
                        criteria,
                        notes
                    });
                }
                if (!Number.isSafeInteger(judge) || judge < 0 || judge > 999) {
                    evidence.push({ hop: 'atk-param', table: atkParamTable, rowId: atkParamRowId, rowName, exists: true });
                    return ok({
                        verdict: 'not-identified',
                        target: { kind: 'atk-param', table: atkParamTable, rowId: atkParamRowId, rowName, skill, weapon },
                        blockedAt: 'BEHAVIOR_PARAM_ROW_MISSING',
                        blockedMessage: `${atkParamTable}#${atkParamRowId} 不在 5000000+judge 的取值范围内，`
                            + '无法按已核对的规则定位 BehaviorParam_PC 行（本次没有扫描整张 BehaviorParam_PC 表）。',
                        criteria,
                        notes
                    });
                }
                targetAttack = await resolveJudge(readParams, edit.session, judge, atkParamTable);
                evidence.push({
                    hop: 'atk-param',
                    table: atkParamTable,
                    rowId: atkParamRowId,
                    rowName,
                    exists: true
                });
                if (targetAttack.verified) {
                    evidence.push({
                        hop: 'behavior-param',
                        table: BEHAVIOR_TABLE,
                        rowId: targetAttack.behaviorParamRowId,
                        behaviorJudgeId: targetAttack.behaviorJudgeId,
                        variationId: targetAttack.variationId,
                        refType: targetAttack.refType,
                        refId: targetAttack.refId,
                        verified: true
                    });
                }
                else {
                    evidence.push({
                        hop: 'behavior-param',
                        table: BEHAVIOR_TABLE,
                        rowId: targetAttack.behaviorParamRowId,
                        behaviorJudgeId: targetAttack.behaviorJudgeId,
                        variationId: targetAttack.variationId,
                        refType: targetAttack.refType,
                        refId: targetAttack.refId,
                        verified: false
                    });
                    return ok({
                        verdict: 'not-identified',
                        target: { kind: 'atk-param', table: atkParamTable, rowId: atkParamRowId, rowName, skill, weapon },
                        blockedAt: targetAttack.failure ?? 'BEHAVIOR_PARAM_REF_MISMATCH',
                        blockedMessage: targetAttack.failure === 'BEHAVIOR_PARAM_ROW_MISSING'
                            ? `BehaviorParam_PC#${targetAttack.behaviorParamRowId}（judge ${judge}）不存在；攻击行没有 BehaviorParam 边。`
                            : targetAttack.failure === 'ATK_PARAM_ROW_MISSING'
                                ? `BehaviorParam_PC#${targetAttack.behaviorParamRowId}.refId=${targetAttack.refId} 指向的 ${atkParamTable} 行不存在。`
                                : `BehaviorParam_PC#${targetAttack.behaviorParamRowId} 的 behaviorJudgeId/refType/refId 与 judge ${judge} / AtkParam#${atkParamRowId} 不一致。`,
                        criteria,
                        notes
                    });
                }
            }
            // ---- 4. Collect attack actions in scope and resolve each distinct judge. ----------
            const scopeAll = scopeActionUris === null ? actions : actions.filter((action) => scopeActionUris.has(action.actionUri));
            const scope = scopeAll.filter((action) => action.attacks.length > 0);
            if (scope.length === 0) {
                return ok({
                    verdict: 'not-identified',
                    target: {
                        kind: atkParamRowId !== undefined ? 'atk-param' : actionText !== undefined ? 'action' : skill !== null ? 'skill' : 'weapon',
                        ...(skill === null ? {} : { skill }),
                        ...(weapon === null ? {} : { weapon }),
                        ...(atkParamRowId === undefined ? {} : { atkParamTable, atkParamRowId })
                    },
                    scope: { label: scopeLabel, taeGroups: weapon?.taeGroups ?? null, actionCount: scopeAll.length },
                    blockedAt: (actionText === undefined ? 'NO_ACTION_CARRIES_JUDGE' : 'ACTION_HAS_NO_ATTACK_BEHAVIOR'),
                    blockedMessage: actionText === undefined
                        ? `${scopeLabel} 里没有携带 Attack Behavior 事件的动作。`
                        : `${actionText} 没有 Attack Behavior 事件；它不是攻击动作，无法反查攻击行。`,
                    criteria,
                    notes
                });
            }
            // With a verified AtkParam target only its judge matters; resolving every other judge in
            // the scope would read hundreds of unrelated BehaviorParam rows and could fail on a
            // missing row that cannot change the answer.
            const scopeJudges = [];
            if (targetAttack !== null && targetAttack.verified) {
                scopeJudges.push(targetAttack.judge);
            }
            else {
                for (const action of scope) {
                    for (const judge of action.judges) {
                        const numeric = Number(judge);
                        if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 999)
                            continue;
                        if (!scopeJudges.includes(numeric))
                            scopeJudges.push(numeric);
                    }
                }
            }
            const judgeMap = new Map();
            for (const judge of scopeJudges) {
                judgeMap.set(judge, await resolveJudge(readParams, edit.session, judge, atkParamTable));
            }
            const toCandidate = (action) => {
                const attackRows = [];
                const unresolvedJudges = [];
                const judges = [];
                for (const judge of action.judges) {
                    const numeric = Number(judge);
                    if (!Number.isSafeInteger(numeric))
                        continue;
                    if (!judges.includes(numeric))
                        judges.push(numeric);
                    const resolved = judgeMap.get(numeric);
                    if (resolved !== undefined && resolved.verified) {
                        if (!attackRows.some((row) => row.judge === numeric)) {
                            attackRows.push({
                                judge: numeric,
                                eventIndices: action.attacks
                                    .filter((attack) => Number(attack.judge) === numeric)
                                    .map((attack) => attack.eventIndex),
                                behaviorParamRowId: resolved.behaviorParamRowId,
                                behaviorJudgeId: resolved.behaviorJudgeId,
                                variationId: resolved.variationId,
                                refType: resolved.refType,
                                refId: resolved.refId,
                                atkParamTable: resolved.atkParamTable,
                                atkParamRowId: resolved.atkParamRowId,
                                atkParamRowName: resolved.atkParamRowName
                            });
                        }
                    }
                    else {
                        unresolvedJudges.push({
                            judge: numeric,
                            reason: resolved?.failure ?? 'NOT_CHECKED_TARGET_ONLY'
                        });
                    }
                }
                return {
                    actionUri: action.actionUri,
                    animId: action.animId,
                    code: action.code,
                    taeGroup: action.taeGroup,
                    ...(action.taeEntryIndex === undefined ? {} : { taeEntryIndex: action.taeEntryIndex }),
                    ...(action.taeEntryId === undefined ? {} : { taeEntryId: action.taeEntryId }),
                    ...(action.taeEntryName === undefined ? {} : { taeEntryName: action.taeEntryName }),
                    eventCount: action.eventCount,
                    eventsComplete: action.eventsComplete,
                    judges,
                    attackRows,
                    unresolvedJudges
                };
            };
            let candidates = scope.map(toCandidate);
            // The AtkParam target turns the scope into a filter: only actions that carry the verified
            // judge of that attack row survive. No name is consulted at this step.
            if (targetAttack !== null && targetAttack.verified) {
                candidates = candidates.filter((candidate) => candidate.attackRows.some((row) => row.atkParamRowId === atkParamRowId));
            }
            // Optional weapon variation edge: BehaviorParam.variationId must equal the weapon's
            // behaviorVariationId for the behavior to be usable by that weapon (schema description).
            // It only narrows; it never picks among equally-matching actions by itself.
            let variationFilterApplied = false;
            if (targetAttack === null && weapon !== null && weapon.behaviorVariationId !== null && weapon.behaviorVariationId !== 0) {
                const filtered = candidates.filter((candidate) => candidate.attackRows.some((row) => row.variationId === weapon.behaviorVariationId));
                if (filtered.length > 0) {
                    candidates = filtered;
                    variationFilterApplied = true;
                    notes.push(`已按 EquipParamWeapon#${weapon.rowId}.behaviorVariationId=${weapon.behaviorVariationId} 过滤候选：`
                        + 'BehaviorParam_PC.variationId 必须等于该值（schema 明确写明的可用性边）。');
                }
            }
            const totalCandidates = candidates.length;
            const soleCandidate = totalCandidates === 1 ? candidates[0] : null;
            // A single action is not enough: the verdict must be backed by a verified judge ->
            // BehaviorParam -> AtkParam chain. If the one surviving action has no verified row, the
            // answer stays not-identified instead of naming it.
            const identifiedAction = soleCandidate !== null && soleCandidate.attackRows.length > 0 ? soleCandidate : null;
            const verdict = identifiedAction === null ? 'not-identified' : 'identified';
            let blockedAt;
            let blockedMessage;
            if (verdict === 'not-identified') {
                if (targetAttack !== null) {
                    if (totalCandidates === 0) {
                        const elsewhere = actions.filter((action) => action.judges.some((judge) => Number(judge) === targetAttack.judge));
                        blockedAt = scopeActionUris === null ? 'NO_ACTION_CARRIES_JUDGE' : 'SCOPE_EXCLUDES_JUDGE';
                        blockedMessage = scopeActionUris !== null
                            ? `${scopeLabel} 的动作里没有携带 judge ${targetAttack.judge} 的 Attack Behavior 事件；`
                                + `容器内其它位置有 ${elsewhere.length} 个动作携带该 judge（见 elsewhere）。`
                                + '这条 id 边只能证明“该范围内没有”，不能证明该动作属于这个技能/武器。'
                            : `容器内没有动作携带 judge ${targetAttack.judge} 的 Attack Behavior 事件。`;
                    }
                    else {
                        blockedAt = 'JUDGE_SHARED_BY_MULTIPLE_ACTIONS';
                        // weaponId only narrows by TAE group. When every candidate already sits in one
                        // group it removes nothing, so recommending it first sends the caller on a
                        // wasted round (judge 86's 8 actions are all in a50). Name the group spread so
                        // the caller can tell which anchor can still help.
                        const candidateTaeGroups = [...new Set(candidates.map((candidate) => candidate.taeGroup))].sort();
                        const anchorHint = candidateTaeGroups.length > 1
                            ? `候选跨越 TAE 组 ${candidateTaeGroups.join('、')}，weaponId 可缩小到其中一组；`
                            : `候选全在 TAE 组 ${candidateTaeGroups.join('、')} 内，weaponId 无法再收敛；`;
                        blockedMessage = `judge ${targetAttack.judge}（${atkParamTable}#${atkParamRowId}）被 ${totalCandidates} 个动作的 Attack Behavior 事件携带；`
                            + 'id 边到达的是一个集合，不是一个动作。'
                            + anchorHint
                            + '要从集合里定到单一动作，请读候选并用其中一条 actionUri 指定 {action} 重新调用。';
                    }
                }
                else if (scopeLabel === 'skill-group') {
                    blockedAt = 'SKILL_HAS_NO_ATK_PARAM_EDGE';
                    blockedMessage = `SkillParam#${skill?.rowId} 只提供 virtualWeaponId=${skill?.virtualWeaponId}；`
                        + `该武器只把范围缩到 TAE 组 ${weapon?.taeGroups.join('、') ?? '（无）'}，`
                        + `${totalCandidates} 个候选动作无法再收敛。数据里没有 SkillParam→AtkParam/animId 字段，`
                        + '也没有 weapon→AtkParam 字段；要判定必须再给 atkParamRowId 或 action 地址。'
                        + (soleCandidate !== null && soleCandidate.attackRows.length === 0
                            ? ` 唯一候选 ${soleCandidate.actionUri} 的 judge 也没能走通 BehaviorParam→AtkParam 链，`
                                + `因此不是 identified：${soleCandidate.unresolvedJudges.map((entry) => `judge ${entry.judge}=${entry.reason}`).join('，')}。`
                            : '');
                }
                else if (scopeLabel === 'weapon-group') {
                    blockedAt = 'WEAPON_HAS_NO_ATK_PARAM_EDGE';
                    blockedMessage = `EquipParamWeapon#${weapon?.rowId} 只把范围缩到 TAE 组 ${weapon?.taeGroups.join('、') ?? '（无）'}，`
                        + `${totalCandidates} 个候选动作无法再收敛；武器行没有指向 AtkParam 的字段。`
                        + '要判定必须再给 atkParamRowId 或 action 地址。';
                }
                else if (scopeLabel === 'action') {
                    blockedAt = soleCandidate?.unresolvedJudges[0]?.reason ?? 'NO_ACTION_CARRIES_JUDGE';
                    blockedMessage = soleCandidate === null
                        ? `动作地址命中 ${totalCandidates} 个动作，无法只凭地址判定。`
                        : `${soleCandidate.actionUri} 的 Attack Behavior judge 没有走通 BehaviorParam→AtkParam 链：`
                            + soleCandidate.unresolvedJudges.map((entry) => `judge ${entry.judge}=${entry.reason}`).join('，')
                            + '。动作地址本身是确定的，但攻击行身份没有证据，不能给出 identified。';
                }
                else {
                    blockedAt = 'JUDGE_SHARED_BY_MULTIPLE_ACTIONS';
                    blockedMessage = `候选集有 ${totalCandidates} 个动作；没有 id 级边能再收敛。`;
                }
            }
            // A single action is not enough: the verdict must be backed by a verified judge ->
            // BehaviorParam -> AtkParam chain. The guard above already turned that case into
            // not-identified, so `verdict === 'identified'` here always carries attackRows.
            const elsewhereAll = targetAttack === null ? [] : actions
                .filter((action) => action.judges.some((judge) => Number(judge) === targetAttack.judge))
                .filter((action) => !candidates.some((candidate) => candidate.actionUri === action.actionUri))
                .map((action) => ({
                actionUri: action.actionUri,
                animId: action.animId,
                code: action.code,
                taeGroup: action.taeGroup,
                taeEntryIndex: action.taeEntryIndex ?? null
            }));
            const elsewhere = elsewhereAll.slice(0, MAX_ELSEWHERE);
            const identifiedEvidence = identifiedAction === null ? [] : [
                {
                    hop: 'tae-action',
                    actionUri: identifiedAction.actionUri,
                    animId: identifiedAction.animId,
                    taeEntryIndex: identifiedAction.taeEntryIndex ?? null,
                    taeGroup: identifiedAction.taeGroup
                },
                ...identifiedAction.attackRows.map((row) => ({
                    hop: 'attack-behavior',
                    eventIndices: row.eventIndices.join(','),
                    judge: row.judge,
                    behaviorParamRowId: row.behaviorParamRowId,
                    behaviorJudgeId: row.behaviorJudgeId,
                    refType: row.refType,
                    refId: row.refId,
                    atkParamTable: row.atkParamTable,
                    atkParamRowId: row.atkParamRowId,
                    atkParamRowName: row.atkParamRowName
                }))
            ];
            const page = candidates.slice(offset, offset + limit);
            const truncated = offset + page.length < candidates.length;
            const nextActions = [];
            if (truncated) {
                nextActions.push({
                    tool: 'identify_skill_action',
                    args: {
                        ...value,
                        offset: offset + limit,
                        limit
                    },
                    reason: '继续读取候选动作页；判定与证据链不变。'
                });
            }
            if (page[0] !== undefined) {
                nextActions.push({
                    tool: 'read_tae_events',
                    args: { file: fileToken, addresses: [page[0].actionUri] },
                    reason: '用原生读回该候选动作的全部事件，确认 judge 出现的 eventIndex 与时间。'
                });
            }
            return ok({
                file: fileToken,
                coverage: scan.partial === true ? 'native-scan-partial' : 'native-scan',
                verdict,
                target: {
                    kind: atkParamRowId !== undefined ? 'atk-param'
                        : actionText !== undefined ? 'action'
                            : skill !== null ? 'skill' : 'weapon',
                    ...(skill === null ? {} : { skill }),
                    ...(weapon === null ? {} : { weapon }),
                    ...(atkParamRowId === undefined ? {} : { atkParamTable, atkParamRowId }),
                    ...(targetAttack === null ? {} : {
                        judge: targetAttack.judge,
                        behaviorParamRowId: targetAttack.behaviorParamRowId,
                        atkParamRowName: targetAttack.atkParamRowName
                    })
                },
                scope: {
                    label: scopeLabel,
                    taeGroups: weapon?.taeGroups ?? null,
                    actionCount: scopeAll.length,
                    attackActionCount: scope.length
                },
                evidence: [...evidence, ...identifiedEvidence],
                identifiedAction: identifiedAction === null ? null : {
                    ...identifiedAction,
                    evidence: identifiedEvidence
                },
                candidates: page,
                offset,
                limit,
                totalCandidateCount: totalCandidates,
                returnedCount: page.length,
                truncated,
                elsewhere,
                elsewhereTotalCount: elsewhereAll.length,
                ...(variationFilterApplied ? { variationFilterApplied: true } : {}),
                ...(blockedAt === undefined ? {} : { blockedAt }),
                ...(blockedMessage === undefined ? {} : { blockedMessage }),
                criteria,
                nextActions,
                notes: [
                    ...notes,
                    '本工具当前只实现玩家链（BehaviorParam_PC + AtkParam_Pc）；NPC 容器（c1xxx…）使用 BehaviorParam + AtkParam_Npc，'
                        + '本提交未实现该链，遇到时 blockedAt 会是行缺失，不能读成“该动作没有攻击”。',
                    ...(targetAttack !== null && targetAttack.verified
                        && candidates.some((candidate) => candidate.unresolvedJudges.some((entry) => entry.reason === 'NOT_CHECKED_TARGET_ONLY'))
                        ? ['给了 atkParamRowId 时只解析该攻击行的 judge；其它 judge 的 NOT_CHECKED_TARGET_ONLY 表示未解析，不是失败。']
                        : []),
                    'rowName 只是原生行标签，用于人读；判定只用 judge、BehaviorParam_PC 行 id/refType/refId 与 AtkParam 行 id。'
                ]
            });
        }
    };
}
//# sourceMappingURL=identify_skill_action.js.map