import { formatActionAddress } from '@soulforge/shared';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { asOptionalString, asRecord, fail, nativePathFromFileToken, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { WEAPON_MOTION_FIELDS } from '../../param/weaponMotion.js';
import { readTaeEvents, scanTaeExport } from '../../editing/taeEdit.js';
import { animationEntryIdOf, describeAnimFamily, familyOfTaeEntry, hkxNameOf, isAnimFamily, isAnimId } from '../../action/animFamily.js';
/**
 * `explain_animation`: turn the weapon-family ↔ animation naming rules into a tool answer.
 *
 * Before this tool the rules lived in people's heads and in commit messages: a TAE child id is
 * `5,000,000 + family`, an animation entry id is `1,000,000,000 + family * 1,000,000 + animId`,
 * and the native file is `a{family:03}_{animId:06}.hkt`. Answering "which families contain
 * A410000" therefore meant hand-computing nine ids and reading nine children. This tool does
 * the arithmetic and, just as important, states the families that do NOT contain the animation:
 * an empty result and a proven absence are different answers.
 *
 * What it deliberately does not answer: which behavior-graph state plays an animation. The
 * behavior graph is hk2016 binary data and this repository has no reader for it, so there is no
 * BehaviorGraph → TAE edge to report. Claiming one would be a guess dressed as evidence.
 */
const DEFAULT_FILE = 'chr/c0000.anibnd.dcx';
/** Same bound as search_tae_events / explain_skill_actions: one scan is a large object. */
const SCAN_CACHE_ENTRIES = 2;
const scanCache = new Map();
const sha256Of = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
/** The field that joins a TAE event to BehaviorParam, compared the way the other TAE tools compare it. */
const JUDGE_FIELD = 'behaviorjudgeid';
const canonicalFieldName = (value) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** The naming rules as data, so the answer explains itself without the caller re-reading the description. */
const NAMING_RULES = [
    'TAE 子项 id = 5,000,000 + family（a70.tae → 5000070）',
    '动画条目 id = 1,000,000,000 + family×1,000,000 + animId（a70 的 A410000 → 1070410000）',
    'TAE 内 hkxName = a{family:03}_{animId:06}.hkt（a070_410000.hkt）',
    'taeGroup = a + family 至少补到两位（70 → a70，5 → a05）；family 来自 EquipParamWeapon.wepmotionCategory'
];
function optionalSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}
function judgesOf(events) {
    const judges = [];
    const seen = new Set();
    let judgeEventCount = 0;
    for (const event of events) {
        let carries = false;
        for (const field of event.fields ?? []) {
            if (canonicalFieldName(field.name ?? '') !== JUDGE_FIELD)
                continue;
            carries = true;
            const key = JSON.stringify(field.value);
            if (seen.has(key))
                continue;
            seen.add(key);
            judges.push(field.value);
        }
        if (carries)
            judgeEventCount++;
    }
    return { judges, judgeEventCount };
}
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
/** Scan the container once per unchanged physical file, exactly like search_tae_events.
 *
 *  A partial scan IS cached here, unlike search_tae_events: that tool declines to cache one so the
 *  next call can retry the actions it could not finish, but this tool only reads presence and
 *  judges, and the partial result is deterministic for the same bytes (the tail budget is fixed).
 *  Re-scanning a 2,219-action container for every animId question cost about a minute per call. */
async function scanContainerCached(input) {
    const key = `${input.edit.session.meta.workspaceId}\0${input.file}`;
    const before = await sha256Of(input.file).catch(() => undefined);
    if (before !== undefined) {
        const hit = scanCache.get(key);
        if (hit !== undefined && hit.sha256 === before) {
            scanCache.delete(key);
            scanCache.set(key, hit);
            return { ...hit.scan, diagnostics: hit.scan.diagnostics };
        }
    }
    const scan = await scanTaeExport(input);
    if (scan.ok && before !== undefined) {
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
/** Family inventory of a container: every TAE child it really has, with its derived family. */
function buildInventory(taeEntries, animations) {
    const entries = new Map();
    for (const child of taeEntries ?? []) {
        const identity = familyOfTaeEntry(child);
        if (identity === null)
            continue;
        entries.set(identity.family, {
            family: identity.family,
            taeGroup: identity.taeGroup,
            taeEntryName: child.entryName,
            taeEntryId: identity.taeEntryId,
            entryIndex: child.entryIndex,
            animationCount: child.animationCount
        });
    }
    if (entries.size > 0)
        return { entries: [...entries.values()].sort((left, right) => left.family - right.family), fromChildList: true };
    // A bare .tae has no child directory; fall back to the animations' own identity so a single
    // family can still be described, and let the caller know absence is not provable this way.
    for (const animation of animations) {
        const identity = familyOfTaeEntry(animation);
        if (identity === null || entries.has(identity.family))
            continue;
        entries.set(identity.family, {
            family: identity.family,
            taeGroup: identity.taeGroup,
            taeEntryName: animation.taeEntryName ?? null,
            taeEntryId: identity.taeEntryId,
            entryIndex: animation.taeEntryIndex ?? null,
            animationCount: 0
        });
    }
    return { entries: [...entries.values()].sort((left, right) => left.family - right.family), fromChildList: false };
}
/** explain_animation: one domain tool declaration, schema and handler. */
export function createExplainAnimationTool(deps = {}) {
    const readParams = deps.readParamFields ?? readParamFields;
    const scanTae = deps.scanTae ?? scanContainerCached;
    const readTae = deps.readTae ?? readTaeEvents;
    return {
        name: 'explain_animation',
        description: 'Answer where an animation id lives across weapon families, and which family a weapon id belongs to, '
            + 'without hand-computing the naming rules. The rules this tool applies: TAE child id = 5,000,000 + family '
            + '(a70.tae = 5000070); animation entry id = 1,000,000,000 + family*1,000,000 + animId (a70 A410000 = 1070410000); '
            + 'native hkx name = a{family:03}_{animId:06}.hkt (a070_410000.hkt); taeGroup = a + family padded to at least two '
            + 'digits; family = EquipParamWeapon.wepmotionCategory of the weapon row. '
            + 'Pass animId (e.g. 410000) to list every family of the container that contains it, each with family, taeGroup, '
            + 'TAE child name, TAE child entry id, animationEntryId, hkxName, the action address, and the distinct '
            + 'Behavior Judge ID values that animation carries. Families that exist in the container without that animId are '
            + 'returned in `absent` with hasAnimId:false and their real animationCount, so a negative answer is provable '
            + 'instead of an empty list. Pass weaponId (e.g. 70000) to get its family and that family\'s TAE child. '
            + 'Pass family (e.g. 74) to check one family directly. animId, weaponId and family may be combined. '
            + 'file defaults to chr/c0000.anibnd.dcx. Cost: a family/weapon question only reads the TAE child directory '
            + '(one preview page, about a second); an animId question scans every animation row of the container (tens of '
            + 'seconds on c0000, then cached per unchanged file inside one process). A partial scan still answers presence, '
            + 'because an animation row exists whether or not its event tail was read; the answer says so and marks the '
            + 'judge lists that may be short with judgesComplete:false. '
            + 'LIMITATION — this tool does NOT answer which behavior-graph state plays an animation: the behavior graph '
            + '(beh.bnd / hk2016) has no reader in this repository, so there is no BehaviorGraph -> TAE edge to report, and '
            + 'none is guessed here. The answer stops at the TAE side (which TAE child, which animation, which judge values); '
            + 'joining a judge to a behavior state needs data this tool cannot read. Read-only.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            animId: 'safe-integer?',
            weaponId: 'safe-integer?',
            family: 'safe-integer?',
            file: 'string?'
        },
        run: async (input, context) => {
            if (context.workspaceIndex === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const animId = optionalSafeInteger(value.animId);
            const weaponId = optionalSafeInteger(value.weaponId);
            const requestedFamily = optionalSafeInteger(value.family);
            if (value.animId !== undefined && animId === undefined) {
                return fail('INVALID_INPUT', `explain_animation 的 animId 必须是安全整数（收到 ${String(value.animId)}）。`);
            }
            if (value.weaponId !== undefined && (weaponId === undefined || weaponId < 0)) {
                return fail('INVALID_INPUT', `explain_animation 的 weaponId 必须是非负安全整数（收到 ${String(value.weaponId)}）。`);
            }
            if (value.family !== undefined && requestedFamily === undefined) {
                return fail('INVALID_INPUT', `explain_animation 的 family 必须是安全整数（收到 ${String(value.family)}）。`);
            }
            if (animId !== undefined && !isAnimId(animId)) {
                return fail('INVALID_INPUT', `explain_animation 的 animId 必须在 0..999999 之间（六位 animId 才能拼进动画条目 id；收到 ${String(animId)}）。`);
            }
            if (requestedFamily !== undefined && !isAnimFamily(requestedFamily)) {
                return fail('INVALID_INPUT', `explain_animation 的 family 必须在 0..999 之间（a{family:03} 只有三位；收到 ${String(requestedFamily)}）。`);
            }
            if (animId === undefined && weaponId === undefined && requestedFamily === undefined) {
                return fail('INVALID_INPUT', 'explain_animation 需要 animId、weaponId 或 family 至少一个：'
                    + 'animId 列出它在所有家族里的出现位置；weaponId 给出该武器的家族与 TAE 子项；family 直接查一个家族。');
            }
            const fileToken = asOptionalString(value.file)?.trim() || DEFAULT_FILE;
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            // 1. weaponId -> EquipParamWeapon.wepmotionCategory -> family.
            let weapon;
            if (weaponId !== undefined) {
                const weaponRead = await readParams({
                    edit: edit.session,
                    queries: [{ table: 'EquipParamWeapon', rowIds: [weaponId],
                            fieldIds: WEAPON_MOTION_FIELDS.map((spec) => spec.field) }]
                });
                if (!weaponRead.ok) {
                    if (weaponRead.error.code === 'PARAM_ROW_NOT_FOUND') {
                        return fail('WEAPON_ROW_NOT_FOUND', `EquipParamWeapon#${weaponId} 不存在，无法从武器行解析家族。先用 search_param_rows 确认武器行 id。`, { weaponId, table: 'EquipParamWeapon' });
                    }
                    return fail(weaponRead.error.code, weaponRead.error.message, weaponRead.error.details);
                }
                const categoryCell = weaponRead.fields.find((field) => field.fieldId === 'wepmotionCategory');
                if (categoryCell === undefined) {
                    // A stub/native reader reports a missing row as "no fields" rather than as an error;
                    // both shapes must fail with the actionable code, not with "field not found".
                    const missingRow = weaponRead.missingRows.some((row) => row.rowId === weaponId);
                    return fail(missingRow ? 'WEAPON_ROW_NOT_FOUND' : 'PARAM_FIELD_NOT_FOUND', missingRow
                        ? `EquipParamWeapon#${weaponId} 不存在，无法从武器行解析家族。先用 search_param_rows 确认武器行 id。`
                        : `EquipParamWeapon#${weaponId} 没有 wepmotionCategory 字段，无法定位武器家族。`, { weaponId, table: 'EquipParamWeapon' });
                }
                const category = Number(categoryCell.value);
                const identity = describeAnimFamily(category);
                if (!Number.isSafeInteger(category) || identity === null) {
                    return fail('INVALID_INPUT', `EquipParamWeapon#${weaponId} 的 wepmotionCategory=${String(categoryCell.value)} 不是可编码的家族`
                        + '（家族必须落在 0..999，才能拼成 a{family:03}）。', { weaponId, wepmotionCategory: categoryCell.value });
                }
                // The override fields name other groups; they do not change the family, but hiding them
                // would repeat the old "a50 is the whole answer" mistake for weapons with a stance override.
                const overrides = [];
                for (const spec of WEAPON_MOTION_FIELDS) {
                    if (spec.field === 'wepmotionCategory')
                        continue;
                    const cell = weaponRead.fields.find((field) => field.fieldId === spec.field);
                    if (cell === undefined)
                        continue;
                    const raw = Number(cell.value);
                    if (!Number.isSafeInteger(raw) || raw <= 0)
                        continue;
                    overrides.push({ field: spec.field, value: raw, role: spec.role, applied: true,
                        ...(describeAnimFamily(raw) === null ? {} : { taeGroup: describeAnimFamily(raw).taeGroup }) });
                }
                weapon = {
                    table: 'EquipParamWeapon',
                    rowId: weaponId,
                    rowName: categoryCell.rowName ?? null,
                    wepmotionCategory: category,
                    family: identity.family,
                    taeGroup: identity.taeGroup,
                    taeEntryId: identity.taeEntryId,
                    motionFields: [
                        { field: 'wepmotionCategory', value: category, role: 'base-category', applied: true, taeGroup: identity.taeGroup },
                        ...overrides
                    ],
                    overrideTaeGroups: [...new Set(overrides.map((field) => field.taeGroup).filter((group) => group !== undefined))],
                    note: `家族取自 EquipParamWeapon#${weaponId}.wepmotionCategory=${String(category)} → family=${String(identity.family)}（${identity.taeGroup}）。`
                        + 'wepmotionOneHandId / wepmotionBothHandId / spAtkcategory 只覆盖姿态或特殊攻击的动作组，不改变家族；'
                        + '它们产生的组列在 overrideTaeGroups。'
                };
            }
            const family = requestedFamily ?? weapon?.family;
            // 2. Read the container. The TAE child directory is enough for a family/weapon question
            // (one preview page, about a second); an animId question needs every animation row, which
            // only a native scan gives. Paying the scan for a one-family lookup made the cheap
            // question cost the same as the expensive one.
            const resolvedFile = resolveIndexedResourceFile(context, fileToken, 'chr');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const nativePath = nativePathFromFileToken(resolvedFile.path);
            const needsAnimationRows = animId !== undefined;
            let scan;
            let chrId = 'c0000';
            let taeEntries;
            let animations = [];
            let previewAnimationCount;
            let previewTaeEntryCount;
            if (needsAnimationRows) {
                let scanned;
                try {
                    scanned = await scanTae({
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
                    return fail(error.code ?? 'TAE_SCAN_FAILED', error instanceof Error ? error.message : 'TAE 扫描失败。');
                }
                if (!scanned.ok)
                    return fail(scanned.error.code, scanned.error.message, scanned.diagnostics);
                scan = scanned;
                chrId = scanned.export.chrId === '' ? 'c0000' : scanned.export.chrId;
                taeEntries = scanned.export.taeEntries;
                animations = scanned.export.animations;
            }
            else {
                const preview = await readTae({ edit: edit.session, file: nativePath });
                if (!preview.ok)
                    return fail(preview.error.code, preview.error.message, preview.diagnostics);
                chrId = preview.chrId === '' ? 'c0000' : preview.chrId;
                taeEntries = preview.taeEntries;
                previewAnimationCount = preview.animationCount;
                previewTaeEntryCount = preview.taeEntryCount;
            }
            const inventory = buildInventory(taeEntries, animations);
            const inventoryByFamily = new Map(inventory.entries.map((entry) => [entry.family, entry]));
            // An action whose event tail could not be read still has its animation row, so it still
            // proves presence or absence of an animId; only its judge list can be short. A page that
            // could not be read at all is different: later animations never entered the scan, so the
            // animId question itself is unanswered from that point on.
            const pageUnreadable = scan?.diagnostics.some((diagnostic) => diagnostic.code === 'TAE_SCAN_PAGE_INCOMPLETE') === true;
            const presenceComplete = !pageUnreadable;
            // 3. animId -> every family that really carries it, and every family that does not.
            let animIdAnswer;
            if (animId !== undefined) {
                const present = [];
                const presentFamilies = new Set();
                for (const animation of animations) {
                    if (animation.animId !== animId)
                        continue;
                    const identity = familyOfTaeEntry(animation);
                    if (identity === null)
                        continue;
                    const derived = describeAnimFamily(identity.family);
                    const animationEntryId = animationEntryIdOf(identity.family, animId);
                    const derivedName = hkxNameOf(identity.family, animId);
                    if (derived === null || animationEntryId === null || derivedName === null)
                        continue;
                    presentFamilies.add(identity.family);
                    const nativeName = typeof animation.hkxName === 'string'
                        ? animation.hkxName : undefined;
                    const { judges, judgeEventCount } = judgesOf(animation.events);
                    const eventCount = animation.eventCount ?? animation.events.length;
                    const eventsComplete = animation.eventsComplete !== false && eventCount === animation.events.length;
                    present.push({
                        family: identity.family,
                        taeGroup: identity.taeGroup,
                        taeEntryName: animation.taeEntryName ?? null,
                        taeEntryId: identity.taeEntryId,
                        taeEntryIndex: animation.taeEntryIndex ?? null,
                        animId,
                        animationEntryId,
                        hkxName: nativeName ?? derivedName,
                        hkxNameSource: nativeName === undefined ? 'derived' : 'native',
                        hkxNameMatchesRule: (nativeName ?? derivedName).toLowerCase() === derivedName.toLowerCase(),
                        actionUri: actionUriOf(chrId, animation),
                        eventCount,
                        eventsComplete,
                        judges,
                        judgeEventCount,
                        judgesComplete: eventsComplete
                    });
                }
                present.sort((left, right) => left.family - right.family || left.taeEntryIndex - right.taeEntryIndex);
                const absent = inventory.entries
                    .filter((entry) => !presentFamilies.has(entry.family))
                    .map((entry) => ({
                    family: entry.family,
                    taeGroup: entry.taeGroup,
                    taeEntryName: entry.taeEntryName,
                    taeEntryId: entry.taeEntryId,
                    animationCount: entry.animationCount,
                    hasAnimId: false
                }));
                const negation = !presenceComplete
                    ? `本次扫描有一页动画没有读出，扫描在该页之后停止；absent 只覆盖已读到的动作，不能据此断言这些家族没有该 animId。请重试或先缩小到具体 family。`
                    : inventory.fromChildList
                        ? `absent 里每个家族都是 ${fileToken} 里真实存在的 TAE 子项（taeEntryName / taeEntryId / animationCount 来自本次原生扫描，`
                            + 'entryId = 5,000,000 + family）；这些子项的动作清单里没有该 animId，所以这是否定结论，不是空结果。'
                            + '该结论依据动画行本身（animId + TAE 子项），不依赖事件尾部是否读全。'
                        : `该文件没有 TAE 子项目录（裸 .tae），absent 只能列出有动作的家族；没有动作的家族无法证明。`
                            + '要得到可证的否定结论，请对 anibnd 容器（如 chr/c0000.anibnd.dcx）提问。';
                animIdAnswer = {
                    animId,
                    presentCount: present.length,
                    absentCount: absent.length,
                    present,
                    absent,
                    absentTaeGroups: absent.map((entry) => entry.taeGroup),
                    presenceComplete,
                    negation
                };
            }
            // 4. family / weapon side: the TAE child the family names, and whether this container has it.
            let familyAnswer;
            if (family !== undefined) {
                const identity = describeAnimFamily(family);
                if (identity === null) {
                    return fail('INVALID_INPUT', `family=${String(family)} 不在 0..999 之内，没有 a{family:03} 拼法。`);
                }
                const entry = inventoryByFamily.get(family);
                familyAnswer = entry === undefined
                    ? {
                        family: identity.family,
                        taeGroup: identity.taeGroup,
                        taeEntryId: identity.taeEntryId,
                        presentInContainer: false,
                        taeEntryName: null,
                        taeEntryIndex: null,
                        animationCount: null,
                        reason: `${fileToken} 里没有 ${identity.taeGroup}.tae 这个 TAE 子项（该容器的子项见 inventory.taeGroups）；`
                            + `这不是"有子项但没动作"，而是该家族根本不在这个容器里。`
                    }
                    : {
                        family: identity.family,
                        taeGroup: identity.taeGroup,
                        taeEntryId: identity.taeEntryId,
                        presentInContainer: true,
                        taeEntryName: entry.taeEntryName,
                        taeEntryIndex: entry.entryIndex,
                        animationCount: entry.animationCount
                    };
            }
            const notes = [
                '家族编号来自 EquipParamWeapon.wepmotionCategory；TAE 子项 id = 5,000,000 + family，'
                    + '动画条目 id = 1,000,000,000 + family×1,000,000 + animId，hkxName = a{family:03}_{animId:06}.hkt。'
            ];
            if (animIdAnswer !== undefined && animIdAnswer.presentCount === 0) {
                notes.push(`容器里没有任何家族含 animId=${String(animId)}：这是按 ${inventory.entries.length} 个 TAE 子项的动作清单得到的否定结论。`);
            }
            if (animIdAnswer !== undefined && animIdAnswer.present.some((item) => !item.hkxNameMatchesRule)) {
                notes.push('有动作的原生 hkxName 与命名规则不一致（hkxNameMatchesRule=false）：该处以原生值为准，规则只用于推算缺失值。');
            }
            if (scan?.partial === true) {
                const incomplete = scan.incompleteActionCount ?? (scan.incompleteActions ?? []).length;
                notes.push(`本次为部分扫描：${incomplete} 个动作的事件尾部没有完整读出，这些动作的 judges 可能不全（对应记录 eventsComplete=false）。`
                    + (presenceComplete
                        ? '动画行本身全部读出，因此「某个家族有没有该 animId」（含 absent 的否定结论）不受影响。'
                        : '并且有一页动画没有读出，absent 的覆盖范围因此不完整，不能当作否定结论。'));
            }
            notes.push('不回答「哪个行为图状态播这个动画」：行为图是 hk2016 二进制，本仓库没有读取器，'
                + '没有 BehaviorGraph → TAE 的边；本工具只给 TAE 侧可证的映射（家族、子项、动画、Behavior Judge ID）。');
            const nextActions = [];
            const firstPresent = animIdAnswer?.present[0];
            if (firstPresent !== undefined) {
                nextActions.push({
                    tool: 'read_tae_events',
                    args: { file: fileToken, addresses: [firstPresent.actionUri], projection: 'compact' },
                    reason: '精读该动画在某个家族里的全部事件（这里只给 judge 列表，事件体要另读）。'
                });
            }
            if (weapon !== undefined) {
                nextActions.push({
                    tool: 'explain_skill_actions',
                    args: { weaponId: weapon.rowId },
                    reason: '按同一武器行列出该家族里带 Attack Behavior 的候选动作与排名依据。'
                });
            }
            return ok({
                file: fileToken,
                coverage: scan === undefined ? 'native-preview'
                    : scan.partial === true ? 'native-scan-partial' : 'native-scan',
                ...(scan === undefined ? {
                    preview: {
                        taeEntryCount: previewTaeEntryCount ?? inventory.entries.length,
                        animationCount: previewAnimationCount ?? null,
                        note: '本次只读了 TAE 子项目录（一页预览）：家族/武器问题不需要动作行，因此没有做整容器扫描。'
                    }
                } : {
                    scan: {
                        ...scan.stats,
                        ...(scan.export.outerFileHash === undefined ? {} : { outerFileHash: scan.export.outerFileHash }),
                        ...(scan.export.sourceHash === undefined ? {} : { sourceHash: scan.export.sourceHash }),
                        ...(scan.partial === true ? {
                            partial: true,
                            incompleteActionCount: scan.incompleteActionCount ?? (scan.incompleteActions ?? []).length
                        } : {})
                    }
                }),
                naming: {
                    rules: [...NAMING_RULES],
                    taeEntryIdBase: 5_000_000,
                    animationEntryIdBase: 1_000_000_000,
                    familyStride: 1_000_000
                },
                inventory: {
                    source: inventory.fromChildList ? 'tae-child-list' : 'animations',
                    taeEntryCount: previewTaeEntryCount ?? scan?.export.taeEntryCount ?? inventory.entries.length,
                    familyCount: inventory.entries.length,
                    taeGroups: inventory.entries.map((entry) => entry.taeGroup)
                },
                ...(weapon === undefined ? {} : { weapon }),
                ...(familyAnswer === undefined ? {} : { family: familyAnswer }),
                ...(animIdAnswer === undefined ? {} : { animation: animIdAnswer }),
                note: notes.join(' '),
                nextActions
            });
        }
    };
}
//# sourceMappingURL=explain_animation.js.map