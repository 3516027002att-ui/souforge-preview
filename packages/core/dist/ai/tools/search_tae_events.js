import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { asRecord } from '.././toolRegistrySupport.js';
import { asString } from '.././toolRegistrySupport.js';
import { boundedContentSearchPage } from '../boundedContentSearchPage.js';
import { fail } from '.././toolRegistrySupport.js';
import { nativePathFromFileToken } from '.././toolRegistrySupport.js';
import { ok } from '.././toolRegistrySupport.js';
import { ragSearchFallback } from '.././toolRegistrySupport.js';
import { requireEditSession } from '.././toolRegistrySupport.js';
import { resolveIndexedResourceFile } from '.././toolRegistrySupport.js';
import { TAE_COMPACT_PAGE_SIZE } from '../../editing/taeCompactEvent.js';
import { scanTaeExport } from '../../editing/taeEdit.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { resolveWeaponMotionCandidates, WEAPON_MOTION_FIELDS } from '../../param/weaponMotion.js';
// First pages of the best-ranked actions share this. Compact fields now carry both `name` and
// `fieldName`, which grew the serialized page: re-measured on three Sekiro character anibnds
// (c0000, c5080, c5400; 86,137 events), a 64-event compact page peaks at 30.9 KB with the alias
// (21.9 KB without it). 44,000 exceeds that peak by 13 KB, so the top action's first page is always
// delivered, and leaves 21.5 KB of the 64 KiB tool-result bound for the six items' metadata and the
// envelope. Keeping 40,000 would buy fewer events for the same input.
const SEARCH_EVENT_BUDGET_BYTES = 44_000;
// Native scans of files the index does not hold, by workspace and physical file, for this process. A scan is reused
// only while the file's sha256 is unchanged. Two entries bound the memory (a c0000 scan is ~74k events).
const SCAN_CACHE_ENTRIES = 2;
const scanCache = new Map();
const sha256Of = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
/** fieldName matching ignores case, spaces and punctuation, so "Behavior Judge ID", "BehaviorJudgeID" and
 *  "behavior_judge_id" are one field. The aliases exist because the schema name is not what a caller types when
 *  joining a BehaviorParam row to the animation that uses it. */
const TAE_FIELD_ALIASES = {
    judge: 'behaviorjudgeid', judgeid: 'behaviorjudgeid',
    判定id: 'behaviorjudgeid', 行动判定id: 'behaviorjudgeid', 行動判定id: 'behaviorjudgeid',
    行为判定id: 'behaviorjudgeid', 行為判定id: 'behaviorjudgeid'
};
function normalizeTaeFieldName(name) {
    return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function canonicalTaeFieldName(fieldName) {
    const requested = normalizeTaeFieldName(fieldName);
    return TAE_FIELD_ALIASES[requested] ?? requested;
}
function isTaeFieldValue(candidate, fieldValue) {
    const text = String(candidate).trim();
    if (text === fieldValue)
        return true;
    const left = Number(text), right = Number(fieldValue);
    return Number.isFinite(left) && Number.isFinite(right) && left === right;
}
/** search_tae_events: one domain tool declaration, schema and handler. */
export function createSearchTaeEventsTool(deps = {}) {
    const readWeaponFields = deps.readParamFields ?? readParamFields;
    return {
        name: 'search_tae_events',
        description: 'Search native TAE actions by any event field, type or address. A hit returns the action’s events in native order as '
            + `compact events (address, index, type, frames and times, decoded fields; hex only for undecoded bodies) in pages of ${TAE_COMPACT_PAGE_SIZE}. `
            + 'Every decoded field carries both name and fieldName with the same value: fieldName is the selector mutate_tae_event_fields accepts, and name is the compatibility alias kept for older readers. '
            + 'limit counts actions. The best-ranked actions get their whole first page within a shared budget; follow each action pagination.nextRead '
            + 'for its remaining pages and nextCursor for more actions. Without file it searches the workspace index (coverage "indexed-snapshot", '
            + 'only actions already read); with file (e.g. chr/c0000.anibnd.dcx) it scans that file natively (coverage "native-scan"; the first scan of '
            + 'a large file can take tens of seconds) and finds actions that were never read. '
            + 'Pass weaponId to resolve that weapon\'s TAE motion groups from every motion field EquipParamWeapon defines, not only '
            + 'wepmotionCategory: wepmotionCategory (base category), wepmotionOneHandId (one-handed stance), wepmotionBothHandId '
            + '(both-handed stance) and spAtkcategory (special-attack override, whose native description says it overwrites the '
            + 'default wepMotionCategory animations). Group names are a<value padded to at least two digits> (50 -> a50, 10 -> a10). '
            + 'A stance value of 0 means "not set" and is not turned into a00. When several rules name several groups the search keeps '
            + 'the union and every match reports resolvedBy / resolvedByFields, so a50 from the category and a10 from the one-hand field '
            + 'are both visible instead of one silently replacing the other; result.weapon.motionFields lists every rule\'s value and '
            + 'the group it produced, applied or not, and it is returned even when nothing matched. '
            + 'Pass fieldName + fieldValue to keep only actions with at least one event whose decoded field carries that value: '
            + 'only those matching events are returned, matchedEventCount counts them, and filteredEventCount reports how many events the filter removed. '
            + 'fieldName accepts any decoded TAE event field name with case, spaces and punctuation ignored ("Behavior Judge ID" = "BehaviorJudgeID" = "behavior_judge_id"), '
            + 'plus the aliases judge / judgeId / 判定ID / 行动判定ID / 行動判定ID for BehaviorJudgeId (e.g. fieldName:"judge" with fieldValue:"15" to join a BehaviorParam row to its animation). '
            + 'A field name that no searched event carries is rejected with TAE_FIELD_FILTER_UNSUPPORTED and the field names that search did offer, never treated as "no filter". '
            + 'Cost note: a whole-file scan on c0000 takes about 100 s, while read_tae_events without addresses lists the same actions in under '
            + 'a second per page; browse with read_tae_events first when you only need the action list.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { query: 'string?', file: 'string?', limit: 'safe-integer?', cursor: 'string?', offset: 'safe-integer?', pageSize: 'safe-integer?', fieldName: 'string?', fieldValue: 'string?', weaponId: 'safe-integer?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            try {
                const pageSize = typeof value.pageSize === 'number' && Number.isSafeInteger(value.pageSize) && value.pageSize > 0
                    ? Math.min(TAE_COMPACT_PAGE_SIZE, value.pageSize) : TAE_COMPACT_PAGE_SIZE;
                const compact = { pageSize, budgetBytes: SEARCH_EVENT_BUDGET_BYTES };
                let scanned;
                if (value.file !== undefined) {
                    const file = asString(value.file).trim();
                    if (!file)
                        return fail('INVALID_INPUT', 'search_tae_events 的 file 必须是非空文件。');
                    const edit = requireEditSession(context, 'read');
                    if (!('session' in edit))
                        return edit;
                    const resolvedFile = resolveIndexedResourceFile(context, file, 'chr');
                    if (!resolvedFile.ok)
                        return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
                    const nativePath = nativePathFromFileToken(resolvedFile.path);
                    const key = `${ws.workspaceId}\0${nativePath}`, sha256 = await sha256Of(nativePath).catch(() => undefined);
                    const hit = sha256 === undefined ? undefined : scanCache.get(key);
                    if (hit && hit.sha256 === sha256) {
                        scanCache.delete(key);
                        scanCache.set(key, hit);
                        scanned = { file, scan: hit.scan, cached: true };
                    }
                    else {
                        const started = Date.now();
                        context.onDiagnostic?.({ phase: 'tae-native-scan', status: 'start' });
                        const scan = await scanTaeExport({ edit: edit.session, file: nativePath, ...(context.signal ? { signal: context.signal } : {}),
                            sourceUri: resolvedFile.canonical === true ? resolvedFile.sourceUri : pathToFileURL(nativePath).href,
                            onPage: progress => context.onDiagnostic?.({ phase: 'tae-native-scan', status: 'progress', elapsedMs: Date.now() - started, details: progress }) });
                        if (!scan.ok) {
                            context.onDiagnostic?.({ phase: 'tae-native-scan', status: 'failed', elapsedMs: Date.now() - started });
                            return fail(scan.error.code, scan.error.message, scan.diagnostics);
                        }
                        context.onDiagnostic?.({ phase: 'tae-native-scan', status: 'complete', elapsedMs: Date.now() - started, details: scan.stats });
                        // A file that changed while it was scanned is not cached; the Bridge versions inside the scan already agree.
                        // A partial scan is not cached either: the next call must be able to retry the unreadable actions.
                        if (sha256 !== undefined && scan.partial !== true && await sha256Of(nativePath).catch(() => undefined) === sha256) {
                            scanCache.delete(key);
                            scanCache.set(key, { sha256, scan });
                            while (scanCache.size > SCAN_CACHE_ENTRIES)
                                scanCache.delete(scanCache.keys().next().value);
                        }
                        scanned = { file, scan, cached: false };
                    }
                }
                // A numeric event field (BehaviorJudgeId and similar) is how a TAE action points at a BehaviorParam
                // row, but the text search ranked by token overlap, so a value like 150 matched everything containing
                // 150 anywhere. A named field filter makes that join answerable — and it is a constraint, so a name no
                // event carries is reported instead of quietly matching every action.
                const fieldName = typeof value.fieldName === 'string' ? value.fieldName.trim() : '';
                const fieldValue = value.fieldValue === undefined ? '' : String(value.fieldValue).trim();
                if ((fieldName === '') !== (fieldValue === '')) {
                    return fail('INVALID_INPUT', 'search_tae_events 的 fieldName 与 fieldValue 必须一起给出（都填或都不填）。');
                }
                let fieldEventsSeen = 0, fieldEventsCarrying = 0, filteredActions;
                const observedFieldNames = [];
                const observedFieldSet = new Set();
                // Resolved once: the predicate runs on every event of a whole-container scan.
                const fieldNameForms = new Set([normalizeTaeFieldName(fieldName), canonicalTaeFieldName(fieldName)]);
                const fieldFilter = fieldName === ''
                    ? undefined
                    : (event) => {
                        fieldEventsSeen++;
                        let carries = false, matched = false;
                        for (const field of event.fields ?? []) {
                            // The index symbol calls it fieldName, the compact projection calls it name.
                            const name = String(field.fieldName ?? field.name ?? '');
                            if (name === '')
                                continue;
                            if (fieldNameForms.has(normalizeTaeFieldName(name))) {
                                carries = true;
                                if (isTaeFieldValue(field.value, fieldValue))
                                    matched = true;
                            }
                            else if (observedFieldSet.size < 40 && !observedFieldSet.has(name)) {
                                observedFieldSet.add(name);
                                observedFieldNames.push(name);
                            }
                        }
                        if (carries)
                            fieldEventsCarrying++;
                        return matched;
                    };
                // "Which actions belong to the 绣丸?" used to be unanswerable: an action carries only A<animId> and a
                // group name. A weapon row names its motion groups (category and stance overrides), so the mapping is a
                // data join rather than a guess about names. Reading only wepmotionCategory hid the override: weapon
                // 110000 is category 50 but wepmotionOneHandId 10, so a50 alone was an incomplete answer.
                const weaponId = value.weaponId;
                let weaponGroups = [];
                let weaponInfo;
                if (weaponId !== undefined) {
                    if (typeof weaponId !== 'number' || !Number.isSafeInteger(weaponId) || weaponId < 0) {
                        return fail('INVALID_INPUT', 'search_tae_events 的 weaponId 必须是非负安全整数。');
                    }
                    const weaponEdit = requireEditSession(context, 'read');
                    if (!('session' in weaponEdit))
                        return weaponEdit;
                    const params = await readWeaponFields({
                        edit: weaponEdit.session,
                        queries: [{ table: 'EquipParamWeapon', rowIds: [weaponId],
                                fieldIds: WEAPON_MOTION_FIELDS.map((spec) => spec.field) }]
                    });
                    if (!params.ok)
                        return fail(params.error.code, params.error.message, params.error.details);
                    const motionValues = {};
                    for (const spec of WEAPON_MOTION_FIELDS) {
                        const cell = params.fields.find((field) => field.fieldId === spec.field);
                        // A field the table does not define stays undefined so the resolver reports "no such field"
                        // instead of "not an integer".
                        if (cell !== undefined)
                            motionValues[spec.field] = Number(cell.value);
                    }
                    const cell = params.fields.find((field) => field.fieldId === 'wepmotionCategory');
                    if (cell === undefined) {
                        return fail('PARAM_FIELD_NOT_FOUND', 'EquipParamWeapon#' + String(weaponId) + ' 没有 wepmotionCategory 字段，无法定位动作分组。');
                    }
                    const category = Number(cell.value);
                    if (!Number.isSafeInteger(category)) {
                        return fail('INVALID_INPUT', 'EquipParamWeapon#' + String(weaponId) + ' 的 wepmotionCategory 不是整数：' + String(cell.value));
                    }
                    const resolved = resolveWeaponMotionCandidates(motionValues);
                    weaponGroups = resolved.groups;
                    const groupNote = resolved.fields.filter((field) => field.applied)
                        .map((field) => `${field.field}=${String(field.value)}→${String(field.taeGroup)}`).join('，');
                    weaponInfo = {
                        rowId: weaponId,
                        wepmotionCategory: category,
                        taeGroup: resolved.groups[0] ?? null,
                        taeGroups: resolved.groups,
                        motionFields: resolved.fields,
                        resolvedBy: resolved.resolvedBy,
                        note: '按 EquipParamWeapon 的全部 motion 字段解析动作组：' + (groupNote || '（没有可用字段）')
                            + '。数值 0 的覆盖字段（wepmotionOneHandId / wepmotionBothHandId / spAtkcategory）视为未设置，不映射到 a00；'
                            + '命中项的 resolvedBy 指明它落在哪个字段产生的组。guardmotionCategory 只决定格挡动画，未用作动作组。'
                    };
                }
                const weaponGroupSet = weaponGroups.length > 0 ? new Set(weaponGroups) : undefined;
                // The filter keeps the union of every rule's group; this maps each hit back to the field(s) that
                // produced its group, so a50 and a10 hits do not look like they came from the same rule.
                const motionFieldsByGroup = new Map();
                for (const field of weaponInfo?.motionFields ?? []) {
                    if (!field.applied || field.taeGroup === undefined)
                        continue;
                    const key = field.taeGroup.toLowerCase();
                    const fields = motionFieldsByGroup.get(key) ?? [];
                    fields.push(field.field);
                    motionFieldsByGroup.set(key, fields);
                }
                const withResolvedBy = (match) => {
                    const fields = motionFieldsByGroup.get(String(match.item.taeGroup ?? '').toLowerCase());
                    return fields === undefined ? match : { ...match, resolvedBy: fields[0], resolvedByFields: fields };
                };
                const sources = scanned ? [scanned.scan.export] : undefined;
                const readPage = (query, window) => {
                    const actionFilter = weaponGroupSet
                        ? { actionFilter: (animation) => weaponGroupSet.has(String(animation.taeGroup ?? '').toLowerCase()) }
                        : {};
                    const scoped = { ...window, compact, ...(fieldFilter ? { eventFilter: fieldFilter } : {}), ...actionFilter };
                    const result = sources
                        ? ws.searchTaeActionGroupsPageIn(sources, query, scoped)
                        : ws.searchTaeActionGroupsPage(query, scoped);
                    filteredActions = result.filteredActions;
                    return result;
                };
                const page = boundedContentSearchPage({ tool: 'search_tae_events', workspaceId: ws.workspaceId, input: value,
                    // A scan cursor is bound to its file: following it without that file is a provider mismatch, not an index search.
                    provider: scanned ? `tae-native-scan-v1:${scanned.scan.export.sourceUri}` : 'indexed-tae-actions-compact-v2',
                    readPage });
                // A field name that no searched event carries must not fall through as "no filter": the caller would read
                // every action as a filtered answer. Say which names this search actually offers instead.
                if (fieldFilter !== undefined && fieldEventsSeen > 0 && fieldEventsCarrying === 0) {
                    const canonical = canonicalTaeFieldName(fieldName);
                    return fail('TAE_FIELD_FILTER_UNSUPPORTED', `本次搜索的 ${fieldEventsSeen} 个事件里没有任何事件带字段「${fieldName}」。fieldName 认解码后的 TAE 字段名`
                        + `（大小写、空格、标点不敏感，例如 "Behavior Judge ID" = "BehaviorJudgeID" = "behavior_judge_id"），`
                        + `另认别名 judge / judgeId / 判定ID / 行动判定ID / 行為判定ID（都指 BehaviorJudgeId）。`
                        + `本次实际出现的字段名：${observedFieldNames.slice(0, 20).join('、') || '（无）'}。`
                        + `如果该字段只出现在尚未索引的容器里，请带 file（例如 chr/c0000.anibnd.dcx）做原生扫描后再搜。`, { requestedFieldName: fieldName, canonicalFieldName: canonical, eventsSeen: fieldEventsSeen,
                        availableFieldNames: observedFieldNames, fieldValue });
                }
                const fieldFilterRecord = fieldFilter === undefined ? {} : {
                    fieldFilter: { fieldName, fieldValue, matchedFieldName: canonicalTaeFieldName(fieldName),
                        excludedActionCount: filteredActions ?? 0 }
                };
                // Both a zero-hit filter and a partial scan must reach the caller: one note must not overwrite the other.
                const responseNote = [
                    fieldFilter !== undefined && page.total === 0
                        ? `没有动作带字段「${fieldName}」=「${fieldValue}」；本次排除了 ${filteredActions ?? 0} 个没有该字段值的动作。`
                        : '',
                    scanned?.scan.partial === true
                        ? `本次为部分扫描：${scanned.scan.incompleteActionCount ?? (scanned.scan.incompleteActions ?? []).length} 个动作没有完整读出，0 命中不代表动作不存在。可先用 read_tae_events 浏览该容器的动作清单。`
                        : ''
                ].filter(Boolean).join(' ');
                if (page.total > 0 || value.cursor !== undefined || scanned || fieldFilter !== undefined)
                    return ok({ ...page,
                        ...fieldFilterRecord,
                        ...(responseNote === '' ? {} : { note: responseNote }),
                        ...(weaponInfo === undefined ? {} : { weapon: weaponInfo }),
                        ...(scanned ? { coverage: scanned.scan.partial === true ? 'native-scan-partial' : 'native-scan',
                            scan: { ...scanned.scan.stats, cached: scanned.cached,
                                ...(scanned.scan.partial === true ? { partial: true, incompleteActions: scanned.scan.incompleteActions ?? [],
                                    ...(scanned.scan.incompleteActionCount === undefined ? {} : { incompleteActionCount: scanned.scan.incompleteActionCount }) } : {}) },
                            nextActions: [...page.nextActions.map(action => ({ ...action, args: { ...action.args, file: scanned.file } })),
                                ...(scanned.scan.partial === true ? [{ tool: 'read_tae_events', args: { file: scanned.file }, reason: '部分扫描时用预览列出动作，再按地址精读。' }] : [])] } : {}),
                        matches: page.matches.map((match) => {
                            const item = match.item;
                            const size = item.eventPageSize;
                            const events = item.events;
                            const annotated = withResolvedBy(match);
                            if (item.eventsFiltered === true) {
                                // A filtered page holds only the matching events, so a native page continuation would be wrong:
                                // report the filtered total and never offer a nextRead that returns unfiltered siblings.
                                const filteredTotal = match.matchedEventCount;
                                return { ...annotated, item: { ...item, events,
                                        pagination: { totalCount: filteredTotal, returnedCount: events.length, offset: 0, pageSize: size,
                                            pageNumber: events.length > 0 ? 1 : null,
                                            totalPages: Math.max(1, Math.ceil(filteredTotal / Math.max(1, size))),
                                            hasMore: events.length < filteredTotal } } };
                            }
                            const totalCount = item.eventCount ?? null;
                            const complete = item.eventsComplete === true;
                            // A delivered preview is exactly the first fixed-size page (or the whole action), so the continuation
                            // starts on a page boundary and read_tae_events numbers the following pages the same way.
                            return { ...annotated, item: { ...item, events,
                                    pagination: { totalCount, returnedCount: events.length, offset: 0, pageSize: size,
                                        pageNumber: complete || events.length > 0 ? 1 : null,
                                        totalPages: totalCount === null ? null : Math.max(1, Math.ceil(totalCount / size)), hasMore: !complete,
                                        ...(complete ? {} : { nextRead: { tool: 'read_tae_events', args: {
                                                    file: item.sourceUri, addresses: [item.address], projection: 'compact', offset: events.length, pageSize: size,
                                                    ...(item.sourceHash ? { expectedSourceHash: item.sourceHash } : {}),
                                                    ...(item.readerSchemaRevision === undefined ? {} : { expectedReaderSchemaRevision: item.readerSchemaRevision })
                                                } } }) } } };
                        }) });
                // A workspace with no semantic corpus at all still answers from the lexical index and a native
                // scan, and that path returns ok(catalog-only). What must not pass silently is a corpus that
                // exists but is unavailable: that is "I could not look", not "nothing there".
                const fallback = await ragSearchFallback(context, page.query, ['tae_event'], page.limit, 'search_tae_events');
                if (!fallback.ok)
                    return fallback;
                // Returning the fallback wholesale made the response shape depend on whether a semantic corpus
                // existed. The page stays the answer; corpus hits ride along under fallback.
                const fallbackData = fallback.data && typeof fallback.data === 'object'
                    ? fallback.data
                    : undefined;
                // The note used to claim the corpus was empty even when it was healthy and simply had no
                // matching chunk. Say which of the two actually happened.
                const corpusUnavailable = fallbackData?.availability !== 'available';
                return ok({
                    ...page,
                    ...(fallbackData === undefined ? {} : { fallback: fallbackData }),
                    // A weapon whose motion fields name no action in this search still has an answer to show: the
                    // resolved groups and their source fields are what the caller came for.
                    ...(weaponInfo === undefined ? {} : { weapon: weaponInfo }),
                    note: corpusUnavailable
                        ? '语义语料不可用，本次只搜索了索引里的 TAE 动作；0 命中不代表动作不存在——传入 file 可直接对该容器做原生扫描后搜索。'
                        : '本次索引里 0 命中不代表动作不存在——传入 file 可直接对该容器做原生扫描后搜索。',
                    nextActions: [{ tool: 'search_tae_events', reason: '带上该容器的 file 再搜一次，会对文件做原生扫描而不只查索引。' }]
                });
            }
            catch (error) {
                return fail(error.code ?? 'TAE_SEARCH_FAILED', error instanceof Error ? error.message : '动作搜索失败。');
            }
        }
    };
}
//# sourceMappingURL=search_tae_events.js.map