/**
 * Agent / CLI TAE facade（问题 6-F）。
 *
 * 读：read-tae-document（anibnd 内所有可解析 TAE 子项的聚合 envelope）。写：只接已有
 * Bridge mutation —— update-event-times / insert-event（write-tae-document），
 * 经 applyNativeMutation → Patch Engine 提交，不直接写盘。
 *
 * 入参是地址字符串（c1050#A0200.e0），内部 parseActionAddress。帧 ↔ 秒在门面层
 * 换算（对外帧 = Math.round(seconds * 30)）。参数字段也必须先由 first-party
 * TAE schema 完整解码，再通过 typed mutation 写回；不把原始文本或未知字节假装成字段。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultReadSessionManager, createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
import { formatActionAddress, formatAnimCode, parseActionAddress } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
import { makeFileResourceUri, makeWorkspaceRelativePath } from '../workspace/resourceUri.js';
import { applyNativeMutation } from './editorMutationService.js';
import { commitTaeEventContainerViaBridge, commitTaeEventViaBridge } from './taeBridgeCommit.js';
import { readTaeBrowse, TAE_BROWSE_ANIMATION_PAGE_SIZE } from './taeBrowse.js';
import { TAE_COMPACT_PAGE_SIZE } from './taeCompactEvent.js';
import { resolveAnibndFile } from './fileToken.js';
export const TAE_FPS = 30;
const TAE_COMPACT_SCOPE_PREFIX = 'tae-events:compact:';
const TAE_FIELD_SIZES = { b: 1, u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4, s64: 8, f32: 4 };
const TAE_INTEGER_RANGES = {
    u8: [0n, 255n], s8: [-128n, 127n], u16: [0n, 65535n], s16: [-32768n, 32767n],
    u32: [0n, 4294967295n], s32: [-2147483648n, 2147483647n], s64: [-9223372036854775808n, 9223372036854775807n]
};
function validTaeEnumEntries(value) {
    // Native schemas serialize an absent enum as null. Any other non-array
    // shape is corrupt evidence, not an absent constraint.
    return value === undefined || value === null || (Array.isArray(value) && value.every(item => (item !== null && typeof item === 'object' && typeof item.name === 'string'
        && typeof item.value === 'number' && Number.isSafeInteger(item.value)
        && item.value >= -2147483648 && item.value <= 2147483647)));
}
/** Compare schema scalars, not bytes. Bridge remains the only native codec.
 * Its EncodeValue accepts numeric strings, bool forms and named enum entries;
 * native readback returns typed values. Unknown/lossy schema evidence fails closed. */
function matchesTaeFieldReadback(before, after, requested) {
    const type = before.type;
    if (!type || !Object.hasOwn(TAE_FIELD_SIZES, type) || before.size !== TAE_FIELD_SIZES[type]
        || !Number.isSafeInteger(before.index) || before.index < 0
        || !Number.isSafeInteger(before.offset) || before.offset < 0
        || after.type !== type || after.size !== before.size || after.offset !== before.offset
        || after.index !== before.index || after.name !== before.name
        || after.isPadding === true || after.assert !== undefined)
        return false;
    if (!validTaeEnumEntries(before.enumEntries) || !validTaeEnumEntries(after.enumEntries))
        return false;
    const enumEntries = before.enumEntries ?? [], observedEnum = after.enumEntries ?? [];
    if (enumEntries.length !== observedEnum.length
        || enumEntries.some((item, index) => item.name !== observedEnum[index].name || item.value !== observedEnum[index].value))
        return false;
    let value = requested;
    if (typeof value === 'string') {
        const text = value;
        const entry = enumEntries.find(item => item.name === text
            || (/^[\x00-\x7F]*$/.test(item.name) && /^[\x00-\x7F]*$/.test(text) && item.name.toLowerCase() === text.toLowerCase()));
        if (entry)
            value = entry.value;
    }
    if (type === 'b') {
        if (typeof value === 'string' && /^(true|false)$/i.test(value.trim()))
            value = value.trim().toLowerCase() === 'true';
        else if (value === 0 || value === 1)
            value = value === 1;
        return typeof value === 'boolean' && after.value === value;
    }
    if (type === 'f32') {
        let numeric;
        if (typeof value === 'number')
            numeric = value === 0 ? 0 : value; // JSON numbers do not retain -0.
        else if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))
            numeric = Number(value);
        else
            return false;
        const expected = Math.fround(numeric);
        return Number.isFinite(expected) && typeof after.value === 'number' && Number.isFinite(after.value)
            && Object.is(Math.fround(after.value), expected);
    }
    const range = TAE_INTEGER_RANGES[type];
    if (!range || typeof after.value !== 'number' || !Number.isSafeInteger(after.value))
        return false;
    let expected;
    if (typeof value === 'number' && Number.isSafeInteger(value))
        expected = BigInt(value);
    else if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()))
        expected = BigInt(value.trim());
    else
        return false;
    return expected >= range[0] && expected <= range[1] && BigInt(after.value) === expected;
}
export function frameFromSeconds(seconds) {
    return Number.isFinite(seconds) ? Math.round(seconds * TAE_FPS) : 0;
}
export function secondsFromFrame(frame) {
    return Number.isFinite(frame) ? frame / TAE_FPS : 0;
}
export async function readTaeEvents(input) {
    const resolved = await resolveAnibndFile(input.edit, input.file, { allowBaseRead: true });
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const wanted = (input.addresses ?? []).map((address) => parseActionAddress(address));
    if (wanted.some((item) => item === null)) {
        return {
            ok: false,
            error: { code: 'TAE_ADDRESS_INVALID', message: `地址无法解析：${(input.addresses ?? []).filter((_, i) => wanted[i] === null).join(', ')}。接受 c<四位编号>#A<动画编号>[.e<事件下标>][.<字段>]（例如 c1050#A0200.e0.startFrame），或 search_tae_events 返回的 action:// URI。` },
            diagnostics: []
        };
    }
    if (wanted.every(address => address.animId === undefined)) {
        if (input.projection === 'compact')
            return { ok: false, error: { code: 'TAE_PROJECTION_REQUIRES_ACTION',
                    message: 'projection "compact" 需要动作或词条地址；文件预览不支持。' }, diagnostics: [] };
        const chrId = extractChrId(resolved.path);
        if (wanted.some(address => address.chr.toLowerCase() !== chrId))
            return {
                ok: false, error: { code: 'TAE_EVENT_NOT_FOUND', message: '请求的角色地址与 TAE 来源不匹配。' }, diagnostics: []
            };
        return readTaeBrowse({ ...input, filePath: resolved.path, loadPage: async (animationPage, animationPageSize) => {
                const envelope = await readTaeEnvelope(input.edit, resolved.path, undefined, { animationPage, animationPageSize });
                if (!envelope.ok)
                    return envelope.result;
                const { animations, ...metadata } = envelope;
                return { ...metadata, animationsTruncated: envelope.animationsTruncated === true,
                    events: projectEvents(envelope.chrId, animations), actions: projectActions(envelope.chrId, animations) };
            } });
    }
    const envelope = await readTaeEnvelope(input.edit, resolved.path, input.addresses);
    if (!envelope.ok)
        return envelope.result;
    if ((input.expectedSourceHash !== undefined && (input.expectedSourceHash !== (envelope.outerFileHash ?? envelope.containerSourceHash ?? envelope.sourceHash)
        || input.expectedSourceHash !== await sha256Of(resolved.path)))
        || (input.expectedReaderSchemaRevision !== undefined && input.expectedReaderSchemaRevision !== envelope.readerSchemaRevision))
        return { ok: false, error: { code: 'TAE_SOURCE_VERSION_CHANGED', message: 'TAE 来源或读取器版本已变化，请重新搜索或读取动作。' }, diagnostics: envelope.diagnostics };
    const chrId = envelope.chrId;
    const events = projectEvents(chrId, envelope.animations);
    const actions = projectActions(chrId, envelope.animations);
    let selected = events;
    if (wanted.length > 0) {
        selected = events.filter((event) => wanted.some((wantedAddr) => matchesAddress(wantedAddr, event)));
        const ambiguous = (input.addresses ?? []).filter((address) => (new Set(events.filter((event) => matchesAddress(parseActionAddress(address), event)).map((event) => JSON.stringify([event.taeEntryIndex, event.taeEntryId, event.taeEntryName, event.taeGroup]))).size > 1));
        if (ambiguous.length > 0) {
            return {
                ok: false,
                error: { code: 'TAE_EVENT_AMBIGUOUS', message: `词条地址在多个 TAE section 中重复，必须指定 section：${ambiguous.join(', ')}`,
                    details: { candidates: events.filter((event) => wanted.some((address) => matchesAddress(address, event))).map((event) => ({ animId: event.animId, taeEntryIndex: event.taeEntryIndex, taeEntryName: event.taeEntryName, address: event.address })) } },
                diagnostics: []
            };
        }
        const missing = (input.addresses ?? []).filter((address, index) => (!events.some((event) => matchesAddress(wanted[index], event))
            && !(wanted[index].eventIndex === undefined && actions.some(action => matchesAddress(wanted[index], { ...action, eventIndex: 0 })))));
        if (missing.length > 0) {
            return {
                ok: false,
                error: { code: 'TAE_EVENT_NOT_FOUND', message: `请求的词条不存在：${missing.join(', ')}（文件 ${resolved.path}）` },
                diagnostics: []
            };
        }
    }
    if (input.cursor && input.offset !== undefined)
        return { ok: false,
            error: { code: 'TAE_CURSOR_SCOPE_MISMATCH', message: '续页只传 cursor，不同时传 offset。' }, diagnostics: [] };
    if (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0))
        return { ok: false,
            error: { code: 'TAE_CURSOR_INVALID', message: 'offset 必须是非负安全整数。' }, diagnostics: [] };
    // A cursor keeps the projection it was created with when the caller omits it; an explicit different projection
    // changes queryScope and is rejected below. A malformed cursor is reported by the paging block.
    let projection = input.projection;
    if (projection === undefined && input.cursor) {
        try {
            if (parseOpaqueCursor(input.cursor).scope.startsWith(TAE_COMPACT_SCOPE_PREFIX))
                projection = 'compact';
        }
        catch { /* reported below */ }
    }
    const maximumEventBytes = Math.max(1, ...selected.map((event) => Buffer.byteLength(JSON.stringify(event), 'utf8')));
    // Compact pages hold a fixed number of events, so their numbering matches the search preview that led here;
    // full pages shrink to the largest full event.
    const pageSize = projection === 'compact'
        ? Math.max(1, Math.min(input.pageSize !== undefined && Number.isSafeInteger(input.pageSize) ? input.pageSize : TAE_COMPACT_PAGE_SIZE, TAE_COMPACT_PAGE_SIZE))
        : Math.max(1, Math.min(normalizeTaePageSize(input.pageSize), Math.floor(24000 / maximumEventBytes)));
    const sourceHash = envelope.outerFileHash ?? envelope.containerSourceHash ?? envelope.sourceHash ?? await sha256Of(resolved.path);
    // queryScope 只做续页时的相等性校验；用工作区相对逻辑 URI，避免把本机
    // 绝对路径编进发往模型的 opaque cursor（base64 可解码，不是脱敏）。
    const overlayRoot = input.edit.session.layers.overlayRoot;
    const queryScope = `${projection === 'compact' ? TAE_COMPACT_SCOPE_PREFIX : 'tae-events:'}${makeFileResourceUri(makeWorkspaceRelativePath(overlayRoot, resolved.path))}:${JSON.stringify([...(input.addresses ?? [])].sort())}`;
    let pagination = {
        returnedCount: selected.length,
        totalCount: selected.length,
        offset: 0,
        hasMore: false,
        nextCursor: null,
        pageNumber: 1, totalPages: 1
    };
    {
        try {
            let cursor = input.cursor;
            if (cursor) {
                const payload = parseOpaqueCursor(cursor);
                // The read-session table is process-global and resolvePage only checks the
                // source hash, so the payload scope alone does not bind the session: a
                // replayed or forged sessionId must belong to this workspace and query.
                const existing = defaultReadSessionManager.getSession(payload.sessionId);
                if (payload.domain !== 'tae' || payload.scope !== queryScope
                    || (existing && (existing.domain !== 'tae' || existing.queryScope !== queryScope
                        || existing.workspaceId !== input.edit.session.meta.workspaceId))) {
                    return {
                        ok: false,
                        error: { code: 'TAE_CURSOR_SCOPE_MISMATCH', message: 'TAE 分页 cursor 与当前文件或读取范围不匹配，请重新读取。' },
                        diagnostics: []
                    };
                }
            }
            else {
                const session = defaultReadSessionManager.createSession({
                    workspaceId: input.edit.session.meta.workspaceId,
                    sourceVersion: { sourceUri: makeFileResourceUri(makeWorkspaceRelativePath(overlayRoot, resolved.path)), sourceHash },
                    domain: 'tae',
                    queryScope,
                    items: selected
                });
                cursor = createOpaqueCursor({
                    sessionId: session.sessionId,
                    offset: input.offset ?? 0,
                    sourceHash,
                    domain: 'tae',
                    scope: queryScope
                });
            }
            const page = defaultReadSessionManager.resolvePage(cursor, sourceHash, pageSize);
            selected = page.items;
            pagination = {
                returnedCount: page.items.length,
                totalCount: page.total,
                offset: page.offset,
                hasMore: page.hasMore,
                nextCursor: page.nextCursor,
                pageNumber: Math.floor(page.offset / pageSize) + 1,
                totalPages: Math.ceil(page.total / pageSize)
            };
        }
        catch (error) {
            const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'TAE_CURSOR_INVALID';
            return {
                ok: false,
                error: { code, message: error instanceof Error ? error.message : String(error) },
                diagnostics: []
            };
        }
    }
    return {
        ok: true,
        filePath: resolved.path,
        chrId,
        readerSchemaRevision: envelope.readerSchemaRevision,
        ...(envelope.sourceHash ? { sourceHash: envelope.sourceHash } : { sourceHash }),
        ...(envelope.outerFileHash ? { outerFileHash: envelope.outerFileHash } : {}),
        ...(envelope.containerSourceHash ? { containerSourceHash: envelope.containerSourceHash } : {}),
        ...(envelope.taeEntryCount !== undefined ? { taeEntryCount: envelope.taeEntryCount } : {}),
        ...(envelope.taeEntries ? { taeEntries: envelope.taeEntries } : {}),
        actions: actions.filter(action => selected.some(event => matchesAddress(parseActionAddress(action.address), event))
            || wanted.some(address => address.eventIndex === undefined && matchesAddress(address, { ...action, eventIndex: 0 }))),
        events: selected,
        pagination,
        ...(projection === 'compact' ? { projection } : {}),
        diagnostics: envelope.diagnostics
    };
}
/** A per-address tail completion is a full native read (tens of seconds on a large container), so one scan
 * may attempt only a bounded number of them; skipped actions keep their preview events and are reported. */
const TAIL_ATTEMPT_LIMIT = 2;
const TAIL_FAILURE_LIMIT = 2;
const TAIL_BUDGET_MS = 90_000;
const INCOMPLETE_ACTION_REPORT_LIMIT = 20;
/** Read a whole TAE source page by page for a native action search (#52), keeping only the searchable projection
 * of each page. Animations whose page truncates their events are read whole by address. The source version must
 * stay the same across every call; a version change or a cancelled scan is returned as a failure, while an action
 * that cannot be read whole degrades to `partial` evidence instead of discarding the rest of the file. */
export async function scanTaeExport(input) {
    const resolved = await resolveAnibndFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    let identity;
    let chrId = '', taeEntryCount, taeEntries;
    const animations = [];
    const diagnostics = [];
    const incompleteActions = [];
    const tailSkipped = [];
    const scanStarted = Date.now();
    let tailAttempts = 0, tailFailures = 0;
    let unreadablePages = 0;
    let pages = 0, completedTails = 0;
    const changed = (next) => identity !== undefined
        && (next.sourceHash !== identity.sourceHash || next.outerFileHash !== identity.outerFileHash || next.readerSchemaRevision !== identity.readerSchemaRevision);
    const versionChanged = () => ({ ok: false,
        error: { code: 'TAE_SOURCE_VERSION_CHANGED', message: 'TAE 来源或读取器版本在扫描期间变化，请重新搜索。' }, diagnostics });
    for (let page = 0;; page++) {
        if (input.signal?.aborted)
            return { ok: false, error: { code: 'TAE_SCAN_CANCELLED', message: 'TAE 扫描已取消。' }, diagnostics };
        const envelope = await readTaeEnvelope(input.edit, resolved.path, undefined, { animationPage: page, animationPageSize: TAE_BROWSE_ANIMATION_PAGE_SIZE });
        if (!envelope.ok) {
            // The first page is the whole scan: without it there is nothing usable to return.
            if (page === 0)
                return envelope.result;
            unreadablePages++;
            diagnostics.push({ severity: 'warning', code: 'TAE_SCAN_PAGE_INCOMPLETE',
                message: `动画第 ${page} 页读取失败，本页之后的动作没有进入结果：${envelope.result.error.message}` });
            break;
        }
        pages++;
        if (changed(envelope))
            return versionChanged();
        identity ??= { ...(envelope.sourceHash ? { sourceHash: envelope.sourceHash } : {}),
            ...(envelope.outerFileHash ? { outerFileHash: envelope.outerFileHash } : {}), readerSchemaRevision: envelope.readerSchemaRevision };
        if (page === 0) {
            chrId = envelope.chrId;
            taeEntryCount = envelope.taeEntryCount;
            taeEntries = envelope.taeEntries;
            diagnostics.push(...envelope.diagnostics.filter(diagnostic => diagnostic.severity !== 'info'));
        }
        for (const paged of envelope.animations) {
            const animId = paged.animId;
            if (animId === undefined)
                continue;
            let anim = paged;
            let eventsComplete = paged.eventsTruncated !== true;
            if (paged.eventsTruncated === true) {
                const address = formatActionAddress({ chr: envelope.chrId, animId, ...sectionSelectorForAnimation(paged) });
                // Completing a truncated action costs a whole per-address native read (tens of seconds on a large
                // container), and a container can hold thousands of actions. Bound that work: it must never turn a
                // search into a multi-minute call. Skipped actions keep their preview events and are reported.
                if (tailAttempts >= TAIL_ATTEMPT_LIMIT || tailFailures >= TAIL_FAILURE_LIMIT
                    || Date.now() - scanStarted > TAIL_BUDGET_MS) {
                    tailSkipped.push(address);
                    eventsComplete = false;
                }
                else {
                    tailAttempts++;
                    const whole = await readTaeEnvelope(input.edit, resolved.path, [address]);
                    const full = whole.ok
                        ? whole.animations.find(candidate => candidate.animId === animId && candidate.taeEntryIndex === paged.taeEntryIndex)
                        : undefined;
                    const readable = whole.ok && !changed(whole) && full !== undefined && full.eventsTruncated !== true
                        && (full.eventCount === undefined || full.events?.length === full.eventCount);
                    if (readable) {
                        anim = full;
                        completedTails++;
                        tailFailures = 0;
                        eventsComplete = true;
                    }
                    else {
                        tailFailures++;
                        eventsComplete = false;
                    }
                }
                if (!eventsComplete) {
                    // One unreadable action must not discard the other actions of the file: keep its preview events,
                    // report it as incomplete, and let the caller decide whether that evidence is enough.
                    incompleteActions.push(address);
                    if (!tailSkipped.includes(address)) {
                        diagnostics.push({ severity: 'warning', code: 'TAE_ACTION_READ_INCOMPLETE',
                            message: `动作 ${address} 的词条没有完整读出；结果保留该动作的预览事件，其余动作不受影响。` });
                    }
                }
            }
            const events = projectEvents(envelope.chrId, [anim]);
            animations.push({ animId, code: formatAnimCode(animId),
                ...(anim.taeEntryIndex === undefined ? {} : { taeEntryIndex: anim.taeEntryIndex }),
                ...(anim.taeEntryId === undefined ? {} : { taeEntryId: anim.taeEntryId }),
                ...(anim.taeEntryName === undefined ? {} : { taeEntryName: anim.taeEntryName }),
                ...(anim.taeGroup === undefined ? {} : { taeGroup: anim.taeGroup }),
                ...(anim.hkxName ? { hkxName: anim.hkxName } : {}),
                eventCount: anim.eventCount ?? events.length, eventsComplete,
                events: events.map(event => ({ uri: event.uri, index: event.eventIndex, eventTypeId: event.eventTypeId,
                    ...(event.taeEntryIndex === undefined ? {} : { taeEntryIndex: event.taeEntryIndex }),
                    ...(event.typeName ? { typeName: event.typeName } : {}),
                    startTime: event.startTime, endTime: event.endTime, startFrame: event.startFrame, endFrame: event.endFrame,
                    ...(event.fields ? { fields: event.fields.map(field => ({ name: field.name, value: field.value,
                            ...(field.index === undefined ? {} : { index: field.index }),
                            ...(field.isPadding === undefined ? {} : { isPadding: field.isPadding }),
                            ...(field.assert === undefined ? {} : { assert: field.assert }),
                            ...(field.assertValid === undefined ? {} : { assertValid: field.assertValid }),
                            ...(field.displayValue === undefined ? {} : { displayValue: field.displayValue }) })) } : {}),
                    ...(event.decodeStatus ? { decodeStatus: event.decodeStatus } : {}),
                    ...(event.decodeStatus !== 'decoded' && event.parameterBytesHex ? { parameterBytesHex: event.parameterBytesHex } : {}) })) });
        }
        input.onPage?.({ pages, animations: animations.length });
        if (!envelope.animationsTruncated || envelope.animations.length === 0)
            break;
    }
    return { ok: true, filePath: resolved.path,
        export: { chrId, sourceUri: input.sourceUri, readerSchemaRevision: identity?.readerSchemaRevision ?? 0,
            ...(identity?.sourceHash ? { sourceHash: identity.sourceHash } : {}),
            ...(identity?.outerFileHash ? { outerFileHash: identity.outerFileHash } : {}),
            ...(taeEntryCount === undefined ? {} : { taeEntryCount }), ...(taeEntries ? { taeEntries } : {}), animations },
        stats: { pages, animations: animations.length, events: animations.reduce((sum, animation) => sum + animation.events.length, 0), completedTails,
            ...(tailSkipped.length > 0 ? { tailSkipped: tailSkipped.length } : {}) },
        ...(incompleteActions.length > 0 ? { incompleteActions: incompleteActions.slice(0, INCOMPLETE_ACTION_REPORT_LIMIT),
            incompleteActionCount: incompleteActions.length } : {}),
        ...(incompleteActions.length > 0 ? { incompleteActions } : {}),
        ...(incompleteActions.length > 0 || unreadablePages > 0 ? { partial: true } : {}),
        diagnostics };
}
function normalizeTaePageSize(value) {
    if (value === undefined)
        return 32;
    if (!Number.isSafeInteger(value) || value < 1 || value > 128)
        return 32;
    return value;
}
/** Only call after the Patch Engine has confirmed the commit. Read/transport
 * and projection failures cannot erase that transaction or trigger a replay. */
async function readCommittedTaeEvents(edit, filePath, addresses) {
    try {
        const reread = await readTaeEnvelope(edit, filePath, addresses);
        return reread.ok
            ? { ok: true, events: projectEvents(reread.chrId, reread.animations), diagnostics: reread.diagnostics }
            : { ok: false, events: [], diagnostics: reread.result.diagnostics };
    }
    catch {
        // Native exceptions may contain filesystem paths or transport credentials.
        // Keep a stable diagnostic here, not the exception message/stack/details.
        return { ok: false, events: [], diagnostics: [{ severity: 'error', code: 'TAE_POST_COMMIT_READBACK_FAILED',
                    message: '写入已提交，但原生回读出现异常，尚未验证；请按 opId 查询或回滚，禁止自动重放。' }] };
    }
}
export async function setTaeEventTimes(input) {
    if (input.edits.length === 0) {
        return { ok: false, error: { code: 'TAE_EDIT_EMPTY', message: '没有要写入的事件时间。' }, diagnostics: [] };
    }
    const resolved = await resolveAnibndFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const addresses = input.edits.map(edit => edit.address);
    const invalidAddress = addresses.find(address => {
        const parsed = parseActionAddress(address);
        return !parsed || parsed.animId === undefined || parsed.eventIndex === undefined;
    });
    if (invalidAddress !== undefined)
        return { ok: false, error: { code: 'TAE_ADDRESS_INVALID', message: `地址需含动画与词条下标：${invalidAddress}。接受 c<四位编号>#A<动画编号>[.e<事件下标>][.<字段>]（例如 c1050#A0200.e0.startFrame），或 search_tae_events 返回的 action:// URI。` }, diagnostics: [] };
    const envelope = await readTaeEnvelope(input.edit, resolved.path, addresses);
    if (!envelope.ok)
        return envelope.result;
    const chrId = envelope.chrId;
    const events = projectEvents(chrId, envelope.animations);
    const before = [];
    const mutations = [];
    const pending = [];
    for (const edit of input.edits) {
        const parsed = parseActionAddress(edit.address);
        if (!parsed || parsed.animId === undefined || parsed.eventIndex === undefined) {
            return {
                ok: false,
                error: { code: 'TAE_ADDRESS_INVALID', message: `地址需含动画与词条下标：${edit.address}。接受 c<四位编号>#A<动画编号>[.e<事件下标>][.<字段>]（例如 c1050#A0200.e0.startFrame），或 search_tae_events 返回的 action:// URI。` },
                diagnostics: []
            };
        }
        const matches = events.filter((item) => matchesAddress(parsed, item));
        if (matches.length > 1) {
            return {
                ok: false,
                error: { code: 'TAE_EVENT_AMBIGUOUS', message: `词条 ${edit.address} 在多个 TAE section 中重复，必须指定 section。` },
                diagnostics: []
            };
        }
        const event = matches[0];
        if (!event) {
            return {
                ok: false,
                error: { code: 'TAE_EVENT_NOT_FOUND', message: `词条不存在：${edit.address}（文件 ${resolved.path}）` },
                diagnostics: []
            };
        }
        if (edit.startFrame === undefined && edit.endFrame === undefined) {
            return {
                ok: false,
                error: { code: 'TAE_EDIT_EMPTY', message: `${edit.address} 需要至少一个 startFrame 或 endFrame。` },
                diagnostics: []
            };
        }
        const startTime = edit.startFrame !== undefined ? secondsFromFrame(edit.startFrame) : event.startTime;
        const endTime = edit.endFrame !== undefined ? secondsFromFrame(edit.endFrame) : event.endTime;
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
            return { ok: false, error: { code: 'TAE_EDIT_INVALID_FRAME', message: `${edit.address} 的帧必须是有限数字。` }, diagnostics: [] };
        }
        before.push(event);
        pending.push({ event, edit });
        mutations.push({
            mutation: 'update-event-times',
            animId: event.animId,
            eventIndex: event.eventIndex,
            startTime,
            endTime,
            ...(event.taeEntryIndex === undefined ? {} : { taeEntryIndex: event.taeEntryIndex })
        });
    }
    const file = await input.edit.indexFile(resolved.path, 'action');
    const expectedHash = file.sha256 || await sha256Of(resolved.path);
    const isContainer = (envelope.taeEntryCount ?? 0) > 0;
    // The commit must use the identity the native read captured, never a freshly sampled disk hash.
    // write-bnd4 compares expectedContainerHash with DcxNativeDocument.SourceHash, which is the physical
    // .dcx hash, and read-tae-document reports exactly that as outerFileHash for an anibnd container.
    // Re-sampling the file after the read would bless an external replacement with stale ordinals; a
    // missing captured hash fails closed instead.
    const expectedCommitHash = envelope.outerFileHash ?? (isContainer ? undefined : envelope.sourceHash);
    if (!expectedCommitHash || expectedCommitHash !== expectedHash)
        return { ok: false,
            error: { code: 'TAE_SOURCE_VERSION_CHANGED', message: 'TAE physical source 在原生读取后改变或缺少 snapshot hash，已拒绝写回。' }, diagnostics: envelope.diagnostics, before };
    const outcome = await applyNativeMutation({
        file: { ...file, sha256: expectedCommitHash },
        sourceUri: file.sourceUri,
        expectedHash: expectedCommitHash,
        stagingRoot: input.edit.stagingRoot,
        allowedRoots: () => [...input.edit.allowedRoots()],
        stagingPrefix: 'tae',
        stagingFileName: `${basename(resolved.path)}.mut.tae`,
        stageWrite: (context) => {
            const request = {
                sourcePath: resolved.path,
                outputPath: context.outputPath,
                expectedDocumentHash: expectedCommitHash,
                allowedRoots: context.allowedRoots,
                writableRoots: context.writableRoots,
                mutations,
                timeoutMs: 120_000,
                ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
            };
            return isContainer
                ? commitTaeEventContainerViaBridge(request)
                : commitTaeEventViaBridge(request);
        },
        title: `TAE set ${mutations.length} event-times in ${basename(resolved.path)}`,
        confirmActionLabel: '提交 TAE 事件时间变更'
    }, { commit: input.edit.commitPort });
    if (outcome.status !== 'committed' || !outcome.result.ok) {
        const diagnostics = outcome.status === 'failed'
            ? outcome.diagnostics
            : outcome.status === 'committed'
                ? outcome.result.diagnostics
                : [{ severity: 'error', code: 'TAE_WRITE_CANCELLED', message: '写入被取消。', sourceUri: file.sourceUri }];
        return {
            ok: false,
            error: { code: diagnostics.find(item => item.severity === 'error')?.code ?? 'TAE_WRITE_FAILED', message: diagnostics.find(item => item.severity === 'error')?.message ?? 'TAE 写入失败。' },
            diagnostics,
            before
        };
    }
    const reread = await readCommittedTaeEvents(input.edit, resolved.path, before.map(event => event.address));
    const after = reread.events;
    const nativeVerified = reread.ok && pending.every(({ event, edit }) => {
        const observed = after.find(item => item.address === event.address);
        return observed !== undefined
            && (edit.startFrame === undefined || Math.abs(observed.startTime - secondsFromFrame(edit.startFrame)) <= 0.00001)
            && (edit.endFrame === undefined || Math.abs(observed.endTime - secondsFromFrame(edit.endFrame)) <= 0.00001);
    });
    return {
        ok: true,
        filePath: resolved.path,
        before,
        after,
        mutations: mutations.length,
        ...(outcome.result.opId ? { opId: outcome.result.opId } : {}),
        ...(outcome.result.backupRoot ? { backupRoot: outcome.result.backupRoot } : {}), nativeVerified,
        diagnostics: [...envelope.diagnostics, ...outcome.result.diagnostics, ...(reread.ok ? [] : reread.diagnostics)]
    };
}
/**
 * Write first-party decoded TAE fields.  The caller may address a field by
 * its stable schema index or by the schema field name.  Padding/assert fields
 * are intentionally rejected; their original bytes remain part of the
 * native document and are preserved by the Bridge writer.
 */
export async function setTaeEventFields(input) {
    if (input.edits.length === 0) {
        return { ok: false, error: { code: 'TAE_EDIT_EMPTY', message: '没有要写入的 TAE 字段。' }, diagnostics: [] };
    }
    const resolved = await resolveAnibndFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const addresses = input.edits.map(edit => edit.address);
    const invalidAddress = addresses.find(address => {
        const parsed = parseActionAddress(address);
        return !parsed || parsed.animId === undefined || parsed.eventIndex === undefined;
    });
    if (invalidAddress !== undefined)
        return { ok: false, error: { code: 'TAE_ADDRESS_INVALID', message: `地址需含动画与词条下标：${invalidAddress}。接受 c<四位编号>#A<动画编号>[.e<事件下标>][.<字段>]（例如 c1050#A0200.e0.startFrame），或 search_tae_events 返回的 action:// URI。` }, diagnostics: [] };
    const envelope = await readTaeEnvelope(input.edit, resolved.path, addresses);
    if (!envelope.ok)
        return envelope.result;
    const events = projectEvents(envelope.chrId, envelope.animations);
    const before = [];
    const mutations = [];
    for (const edit of input.edits) {
        const parsed = parseActionAddress(edit.address);
        if (!parsed || parsed.animId === undefined || parsed.eventIndex === undefined) {
            return {
                ok: false,
                error: { code: 'TAE_ADDRESS_INVALID', message: `地址需含动画与词条下标：${edit.address}。接受 c<四位编号>#A<动画编号>[.e<事件下标>][.<字段>]（例如 c1050#A0200.e0.startFrame），或 search_tae_events 返回的 action:// URI。` },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        const matches = events.filter((item) => matchesAddress(parsed, item));
        if (matches.length > 1) {
            return {
                ok: false,
                error: { code: 'TAE_EVENT_AMBIGUOUS', message: `词条 ${edit.address} 在多个 TAE section 中重复，必须指定 section。` },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        const event = matches[0];
        if (!event) {
            return {
                ok: false,
                error: { code: 'TAE_EVENT_NOT_FOUND', message: `词条不存在：${edit.address}（文件 ${resolved.path}）` },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        if (event.parameterDecoded !== true || !event.fields) {
            return {
                ok: false,
                error: {
                    code: 'TAE_SCHEMA_COVERAGE_GAP',
                    message: `${edit.address} 没有可写的 first-party 字段解码结果，已拒绝原始字节猜写。`
                },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        if (edit.fieldIndex !== undefined
            && (!Number.isSafeInteger(edit.fieldIndex) || edit.fieldIndex < 0)) {
            return {
                ok: false,
                error: { code: 'TAE_FIELD_INDEX_INVALID', message: `${edit.address} 的 fieldIndex 必须是非负安全整数。` },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        // `name` is the key an older read_tae_events returned for the same field; accept it as an alias
        // so a selector copied from a read is never silently empty.
        const wantedFieldName = edit.fieldName ?? edit.name;
        if (edit.fieldIndex === undefined && !wantedFieldName) {
            return {
                ok: false,
                error: { code: 'TAE_FIELD_SELECTOR_REQUIRED', message: `${edit.address} 需要 fieldIndex、fieldName 或 name。` },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        const candidates = event.fields.filter((field) => ((edit.fieldIndex === undefined || field.index === edit.fieldIndex)
            && (wantedFieldName === undefined || field.name === wantedFieldName)));
        if (candidates.length !== 1) {
            return {
                ok: false,
                error: {
                    code: candidates.length === 0 ? 'TAE_FIELD_NOT_FOUND' : 'TAE_FIELD_AMBIGUOUS',
                    message: `${edit.address} 无法唯一定位字段${wantedFieldName ? ` ${wantedFieldName}` : ` #${edit.fieldIndex}`}。`
                },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        const field = candidates[0];
        if (field.isPadding === true || field.assert !== undefined) {
            return {
                ok: false,
                error: { code: 'TAE_FIELD_PADDING_READONLY', message: `${edit.address}.${field.name} 是保留/断言字段，原始字节只能保留不能改写。` },
                diagnostics: envelope.diagnostics,
                before
            };
        }
        before.push(event);
        mutations.push({
            mutation: 'set-event-field',
            animId: event.animId,
            eventIndex: event.eventIndex,
            ...(field.index === undefined ? {} : { fieldIndex: field.index }),
            ...(wantedFieldName === undefined ? {} : { fieldName: wantedFieldName }),
            value: edit.value,
            ...(event.schemaBankId === undefined ? {} : { schemaBankId: event.schemaBankId }),
            ...(event.taeEntryIndex === undefined ? {} : { taeEntryIndex: event.taeEntryIndex })
        });
    }
    const file = await input.edit.indexFile(resolved.path, 'action');
    const expectedHash = file.sha256 || await sha256Of(resolved.path);
    const isContainer = (envelope.taeEntryCount ?? 0) > 0;
    // The commit must use the identity the native read captured, never a freshly sampled disk hash.
    // write-bnd4 compares expectedContainerHash with DcxNativeDocument.SourceHash, which is the physical
    // .dcx hash, and read-tae-document reports exactly that as outerFileHash for an anibnd container.
    // Re-sampling the file after the read would bless an external replacement with stale ordinals; a
    // missing captured hash fails closed instead.
    const expectedCommitHash = envelope.outerFileHash ?? (isContainer ? undefined : envelope.sourceHash);
    if (!expectedCommitHash || expectedCommitHash !== expectedHash)
        return { ok: false,
            error: { code: 'TAE_SOURCE_VERSION_CHANGED', message: 'TAE physical source 在原生读取后改变或缺少 snapshot hash，已拒绝写回。' }, diagnostics: envelope.diagnostics, before };
    const outcome = await applyNativeMutation({
        file: { ...file, sha256: expectedCommitHash },
        sourceUri: file.sourceUri,
        expectedHash: expectedCommitHash,
        stagingRoot: input.edit.stagingRoot,
        allowedRoots: () => [...input.edit.allowedRoots()],
        stagingPrefix: 'tae',
        stagingFileName: `${basename(resolved.path)}.fields.mut.tae`,
        stageWrite: (context) => {
            const request = {
                sourcePath: resolved.path,
                outputPath: context.outputPath,
                expectedDocumentHash: expectedCommitHash,
                allowedRoots: context.allowedRoots,
                writableRoots: context.writableRoots,
                mutations,
                timeoutMs: 120_000,
                ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
            };
            return isContainer
                ? commitTaeEventContainerViaBridge(request)
                : commitTaeEventViaBridge(request);
        },
        title: `TAE set ${mutations.length} event-fields in ${basename(resolved.path)}`,
        confirmActionLabel: '提交 TAE 事件字段变更'
    }, { commit: input.edit.commitPort });
    if (outcome.status !== 'committed' || !outcome.result.ok) {
        const diagnostics = outcome.status === 'failed'
            ? outcome.diagnostics
            : outcome.status === 'committed'
                ? outcome.result.diagnostics
                : [{ severity: 'error', code: 'TAE_WRITE_CANCELLED', message: '写入被取消。', sourceUri: file.sourceUri }];
        return {
            ok: false,
            error: { code: diagnostics.find(item => item.severity === 'error')?.code ?? 'TAE_WRITE_FAILED', message: diagnostics.find(item => item.severity === 'error')?.message ?? 'TAE 字段写入失败。' },
            diagnostics,
            before
        };
    }
    const reread = await readCommittedTaeEvents(input.edit, resolved.path, before.map(event => event.address));
    const after = reread.events;
    const nativeVerified = reread.ok && input.edits.every((edit, index) => {
        const previous = before[index];
        const observed = after.find(event => event.address === previous.address);
        if (observed?.parameterDecoded !== true || observed.eventTypeId !== previous.eventTypeId
            || observed.schemaBankId !== previous.schemaBankId || observed.schemaVariant !== previous.schemaVariant)
            return false;
        const selected = (value) => (edit.fieldIndex === undefined || value.index === edit.fieldIndex)
            && (edit.fieldName === undefined || value.name === edit.fieldName);
        const original = previous.fields?.filter(selected), fields = observed.fields?.filter(selected);
        return original?.length === 1 && fields?.length === 1 && matchesTaeFieldReadback(original[0], fields[0], edit.value);
    });
    return {
        ok: true,
        filePath: resolved.path,
        before,
        after,
        mutations: mutations.length,
        ...(outcome.result.opId ? { opId: outcome.result.opId } : {}),
        ...(outcome.result.backupRoot ? { backupRoot: outcome.result.backupRoot } : {}), nativeVerified,
        diagnostics: [...envelope.diagnostics, ...outcome.result.diagnostics, ...(reread.ok ? [] : reread.diagnostics)]
    };
}
/**
 * 760-style proximity events enable only where the effective enable range reaches the reference
 * distance. `Enable Range Maximum` below `Reference Distance` is a semantically dead event — the
 * writer will happily commit it (a round-40 acceptance inserted one), so refuse it before staging.
 * Returned message names the two values so the caller can fix either side.
 */
function unreachableEnableRange(template, overrides) {
    const effective = new Map();
    for (const field of template.fields ?? []) {
        if (typeof field.name === 'string')
            effective.set(field.name, field.value);
    }
    for (const override of overrides ?? []) {
        const name = override.fieldName
            ?? (typeof override.fieldIndex === 'number'
                ? (template.fields ?? []).find((field) => field.index === override.fieldIndex)?.name
                : undefined);
        if (typeof name === 'string')
            effective.set(name, override.value);
    }
    const distance = Number(effective.get('Reference Distance'));
    const maximum = Number(effective.get('Enable Range Maximum'));
    if (!Number.isFinite(distance) || !Number.isFinite(maximum))
        return undefined;
    const enable = effective.get('Enable');
    if (enable === false || enable === 0 || enable === 'False' || enable === 'false')
        return undefined;
    if (maximum >= distance)
        return undefined;
    return `新词条的 Reference Distance=${distance} 大于 Enable Range Maximum=${maximum}：启用范围到不了引用距离，这个事件永远不会启用。`
        + `请把 Enable Range Maximum 提到 >= ${distance}，或把 Reference Distance 降到 <= ${maximum}。`;
}
/**
 * Two spellings of one container are one document; a container read twice would report a
 * different sourceHash for the same bytes. Windows paths fold case (the filesystem does),
 * POSIX ones do not.
 */
export function sameTaeDocumentPath(left, right) {
    const normalize = (value) => {
        const absolute = resolve(value);
        return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    };
    return normalize(left) === normalize(right);
}
/**
 * Which addresses the target document must deliver before a template can be resolved.
 * A template address is only readable from the target document when the template lives there —
 * including the case where `template.file` merely repeats the target file. Excluding it whenever
 * `file` was present made that spelling search a document that never held the template, so the
 * documented `{file, address}` failed as TAE_TEMPLATE_NOT_FOUND while the same call without
 * `file` succeeded.
 */
export function taeTargetReadAddresses(events, sources, targetPath) {
    return events.flatMap((event, index) => {
        const source = sources[index];
        const templateLivesHere = source?.kind === 'target'
            || (source?.kind === 'container' && sameTaeDocumentPath(source.path, targetPath));
        const templateAddress = event?.template?.address;
        return [event.address, ...(templateLivesHere && typeof templateAddress === 'string' ? [templateAddress] : [])];
    });
}
/**
 * Resolve every named template container once, before the target document is read: the same path
 * decides what the target read must deliver and whether a second document is read, and those two
 * decisions have to agree. `files` keeps the resolution so the staging loop reuses it instead of
 * resolving a second time (a file that changed meaning in between would stage the wrong bytes).
 */
export async function prepareTaeTemplateSources(edit, events) {
    const files = await Promise.all(events.map(async (event) => {
        const token = typeof event.template?.file === 'string' ? event.template.file.trim() : '';
        return token === '' ? undefined : await resolveAnibndFile(edit, token);
    }));
    return {
        files,
        sources: files.map(file => (file === undefined
            ? { kind: 'target' } : file.ok ? { kind: 'container', path: file.path } : { kind: 'unresolved' }))
    };
}
/** Host-resolved templates; Bridge owns byte layout and typed-field validation. */
export async function insertTaeEvents(input) {
    const failure = (code, message, diagnostics = []) => ({ ok: false, error: { code, message }, diagnostics });
    if (!Array.isArray(input.events) || input.events.length === 0 || input.events.length > 64)
        return failure('TAE_INSERT_INVALID', 'events 必须包含 1–64 条新增词条。');
    if (input.events.some(e => !e || typeof e.address !== 'string' || !e.template || typeof e.template.address !== 'string'))
        return failure('TAE_INSERT_INVALID', '每条新增词条必须指定目标和模板地址。');
    const resolved = await resolveAnibndFile(input.edit, input.file);
    if (!resolved.ok)
        return failure(resolved.error.code, resolved.error.message);
    const { files: templateFiles, sources: templateSources } = await prepareTaeTemplateSources(input.edit, input.events);
    const envelope = await readTaeEnvelope(input.edit, resolved.path, taeTargetReadAddresses(input.events, templateSources, resolved.path));
    if (!envelope.ok)
        return envelope.result;
    const current = projectEvents(envelope.chrId, envelope.animations);
    const mutations = [];
    const templates = [];
    const added = [];
    for (const [index, item] of input.events.entries()) {
        const address = parseActionAddress(item.address);
        const templateAddress = item.template && parseActionAddress(item.template.address);
        if (!address || address.animId === undefined || address.eventIndex !== undefined
            || !templateAddress || templateAddress.animId === undefined || templateAddress.eventIndex === undefined)
            return failure('TAE_ADDRESS_INVALID', '目标需动作级地址，模板需完整词条地址。');
        if (!Number.isSafeInteger(item.eventTypeId) || item.eventTypeId < 0
            || !Number.isFinite(item.startFrame) || !Number.isFinite(item.endFrame) || item.startFrame > item.endFrame)
            return failure('TAE_INSERT_INVALID', '词条类型和起止帧无效。');
        const targetAnims = envelope.animations.filter(a => a.animId === address.animId
            && address.chr.toLowerCase() === envelope.chrId.toLowerCase()
            && (address.taeEntryIndex === undefined || address.taeEntryIndex === a.taeEntryIndex)
            && (address.taeEntryId === undefined || address.taeEntryId === a.taeEntryId)
            && (address.taeEntryName === undefined || address.taeEntryName === a.taeEntryName)
            && (address.taeGroup === undefined || address.taeGroup === a.taeGroup));
        // 'not found' and 'ambiguous across sections' were one sentence, so the caller could not tell which fix the
        // address needed; a round-7 agent read the template variant as 'cross-section templates are unsupported'.
        if (targetAnims.length === 0)
            return failure('TAE_EVENT_NOT_FOUND', '目标动作 ' + item.address + ' 不存在：先用 read_tae_events 列出该容器动作，确认 A<动画编号> 与所属 section。');
        if (targetAnims.length > 1)
            return failure('TAE_EVENT_AMBIGUOUS', '目标动作地址 ' + item.address + ' 匹配到 ' + String(targetAnims.length) + ' 个 section；请把地址补全到具体 section。');
        const target = targetAnims[0];
        const templateFile = templateFiles[index] ?? resolved;
        if (!templateFile.ok)
            return failure(templateFile.error.code, templateFile.error.message);
        const templateEnvelope = sameTaeDocumentPath(templateFile.path, resolved.path) ? envelope : await readTaeEnvelope(input.edit, templateFile.path, [item.template.address]);
        if (!templateEnvelope.ok)
            return templateEnvelope.result;
        const matches = projectEvents(templateEnvelope.chrId, templateEnvelope.animations).filter(e => matchesAddress(templateAddress, e));
        if (matches.length === 0)
            return failure('TAE_TEMPLATE_NOT_FOUND', '模板事件 ' + String(item.template?.address ?? '') + ' 不在 ' + basename(templateFile.path) + ' 里：先 read_tae_events 用同一个 file 读该动作，确认事件下标与词条类型后再引用。');
        if (matches.length > 1)
            return failure('TAE_EVENT_AMBIGUOUS', '模板地址 ' + String(item.template?.address ?? '') + ' 匹配到 ' + String(matches.length) + ' 个事件（不同 section 可能同址）；请改用该事件的实际地址。');
        const template = matches[0];
        if (template.eventTypeId !== item.eventTypeId)
            return failure('TAE_TEMPLATE_TYPE_MISMATCH', '模板词条类型与新增词条类型必须相同。');
        if (item.fields !== undefined && (!Array.isArray(item.fields) || item.fields.some(f => !f || typeof f !== 'object'
            || (f.fieldIndex === undefined && !f.fieldName) || !['string', 'number', 'boolean'].includes(typeof f.value))))
            return failure('TAE_TEMPLATE_FIELDS_INVALID', 'fields 必须是有选择器和值的字段数组。');
        // A 760-style proximity event with Reference Distance beyond Enable Range Maximum can never enable:
        // the range never reaches the distance. The writer happily committed that as a valid 760 in an
        // acceptance round, so validate the effective values (template overridden by `fields`) before staging.
        const unreachable = unreachableEnableRange(template, item.fields);
        if (unreachable)
            return failure('TAE_EVENT_UNREACHABLE', unreachable);
        const pendingCount = added.filter(a => a.animId === target.animId && a.entryIndex === target.taeEntryIndex).length;
        added.push({ animId: target.animId, ...(target.taeEntryIndex === undefined ? {} : { entryIndex: target.taeEntryIndex }), eventIndex: (target.events?.length ?? 0) + pendingCount });
        mutations.push({ mutation: 'insert-event', animId: target.animId, templateAnimId: template.animId,
            templateEventIndex: template.eventIndex, eventTypeId: item.eventTypeId,
            startTime: item.startFrame / TAE_FPS, endTime: item.endFrame / TAE_FPS,
            ...(target.taeEntryIndex === undefined ? {} : { taeEntryIndex: target.taeEntryIndex }),
            ...(template.schemaBankId === undefined ? {} : { schemaBankId: template.schemaBankId }),
            ...(item.fields ? { fieldOverrides: item.fields } : {}) });
        // The template identity must be the one the native read captured, never a fresh disk sample.
        // Sampling here would bless an external replacement with the template ordinal read before it,
        // exactly the hole a64ad321 closed for the target. A container reports its physical .dcx hash
        // as outerFileHash; a loose .tae reports sourceHash. Neither captured => fail closed.
        const templateIsContainer = (templateEnvelope.taeEntryCount ?? 0) > 0;
        const capturedTemplateHash = templateEnvelope.outerFileHash
            ?? (templateIsContainer ? undefined : templateEnvelope.sourceHash);
        if (!capturedTemplateHash)
            return failure('TAE_TEMPLATE_VERSION_CHANGED', '模板 ' + basename(templateFile.path) + ' 缺少原生读取时捕获的物理哈希，已拒绝插入。', templateEnvelope.diagnostics);
        templates.push({ path: templateFile.path, ...(template.taeEntryIndex === undefined ? {} : { entryIndex: template.taeEntryIndex }),
            hash: capturedTemplateHash });
    }
    const file = await input.edit.indexFile(resolved.path, 'action');
    // A blanket refusal used to sit here. It was measured against a Bridge build whose insert
    // appender only copied the event table, leaving event data blocks, event groups and time
    // slots bound to the old table — the product committed but could not be read back. The
    // writer now relocates the time table, every event data block and the event group table
    // with rebased member references, and re-reads the result before committing; those
    // invariants are pinned by TaeInsertEventReadbackTests. Only the version checks remain.
    // Same identity domain as the event edits: write-bnd4 wants the physical .dcx hash, and the
    // captured outerFileHash is that hash for a container. A fresh disk sample here would bless an
    // external replacement after the read; a missing captured identity fails closed.
    const physicalHash = file.sha256 || await sha256Of(resolved.path);
    const expectedHash = envelope.outerFileHash ?? envelope.sourceHash;
    if (!expectedHash || expectedHash !== physicalHash)
        return failure('TAE_SOURCE_VERSION_CHANGED', 'TAE physical source 在原生读取后改变或缺少 snapshot hash，已拒绝插入。', envelope.diagnostics);
    // The same captured-versus-disk comparison for every template. The target guard above owns the
    // document being written; a template in another container keeps the hash its own native read
    // captured, so a replacement between that read and staging is refused here instead of being
    // staged with a stale template ordinal.
    for (const template of templates) {
        if (sameTaeDocumentPath(template.path, resolved.path))
            continue;
        if (await sha256Of(template.path) !== template.hash)
            return failure('TAE_TEMPLATE_VERSION_CHANGED', '模板 ' + basename(template.path) + ' 在原生读取后改变，已拒绝插入。', envelope.diagnostics);
    }
    const outcome = await applyNativeMutation({ file: { ...file, sha256: expectedHash }, sourceUri: file.sourceUri, expectedHash,
        stagingRoot: input.edit.stagingRoot, allowedRoots: () => [...input.edit.allowedRoots()], stagingPrefix: 'tae',
        stagingFileName: `${basename(resolved.path)}.insert.tae`,
        stageWrite: async (context) => {
            const prepared = [];
            for (let index = 0; index < mutations.length; index++) {
                const template = templates[index];
                if (!(await input.edit.session.resolveWritablePathSecure(template.path)).ok)
                    return { ok: false, diagnostics: [{ severity: 'error', code: 'TAE_TEMPLATE_PATH_BLOCKED', message: '模板路径越出安全工作区。' }] };
                if (await sha256Of(template.path) !== template.hash)
                    return { ok: false, diagnostics: [{ severity: 'error', code: 'TAE_TEMPLATE_HASH_MISMATCH', message: '模板在读取后改变。' }] };
                let path = template.path;
                if (template.entryIndex !== undefined) {
                    path = join(context.writableRoots[0], `template-${index}.tae`);
                    const extract = await runBridge({ command: 'extract-bnd4-child', filePath: template.path,
                        allowedRoots: context.allowedRoots, writableRoots: context.writableRoots,
                        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
                        commandOptions: { outputPath: path, entryIndex: template.entryIndex }, timeoutMs: 120000 });
                    if (extract.parseStatus === 'failed')
                        return { ok: false, diagnostics: extract.diagnostics };
                    const extractedSnapshot = extract.data;
                    if (extractedSnapshot?.sourceHash !== template.hash)
                        return { ok: false, diagnostics: [{ severity: 'error', code: 'TAE_TEMPLATE_HASH_MISMATCH', message: '提取器的原生 physical snapshot 与已读取模板不一致。' }] };
                }
                const bytes = await readFile(path);
                if (await sha256Of(template.path) !== template.hash)
                    return { ok: false, diagnostics: [{ severity: 'error', code: 'TAE_TEMPLATE_HASH_MISMATCH', message: '模板在暂存期间改变。' }] };
                prepared.push({ ...mutations[index], templateDocumentBase64: bytes.toString('base64'), expectedTemplateDocumentHash: createHash('sha256').update(bytes).digest('hex') });
            }
            const request = { sourcePath: resolved.path, outputPath: context.outputPath, expectedDocumentHash: expectedHash,
                allowedRoots: context.allowedRoots, writableRoots: context.writableRoots, mutations: prepared, timeoutMs: 120000,
                ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}) };
            return (envelope.taeEntryCount ?? 0) > 0 ? commitTaeEventContainerViaBridge(request) : commitTaeEventViaBridge(request);
        }, title: `TAE insert ${mutations.length} native events in ${basename(resolved.path)}`, confirmActionLabel: '提交 TAE 新增词条' }, { commit: input.edit.commitPort });
    if (outcome.status !== 'committed' || !outcome.result.ok) {
        const diagnostics = outcome.status === 'failed' ? outcome.diagnostics
            : outcome.status === 'committed' ? outcome.result.diagnostics : [{ severity: 'error', code: 'TAE_WRITE_CANCELLED', message: '写入被取消。' }];
        const diagnostic = diagnostics.find(item => item.severity === 'error');
        return failure(diagnostic?.code ?? 'TAE_WRITE_FAILED', diagnostic?.message ?? 'TAE 新增失败。', diagnostics);
    }
    const reread = await readCommittedTaeEvents(input.edit, resolved.path, input.events.map(e => e.address));
    const after = reread.events.filter(e => added.some(a => a.animId === e.animId && a.entryIndex === e.taeEntryIndex && a.eventIndex === e.eventIndex));
    // The success body must prove itself: the file-level before/after hashes used to exist only inside
    // transaction.operations[].operation.files, so a caller holding just the tool result had no hash
    // to check. Both are physical outer-file hashes (the same identity the Patch Engine CAS used).
    const afterHash = await sha256Of(resolved.path).catch(() => undefined);
    return { ok: true, filePath: resolved.path, sourceUri: file.sourceUri,
        beforeHash: expectedHash, ...(afterHash === undefined ? {} : { afterHash }),
        before: current.filter(e => added.some(a => a.animId === e.animId && a.entryIndex === e.taeEntryIndex)),
        after, mutations: mutations.length, nativeVerified: reread.ok && after.length === mutations.length,
        opId: outcome.result.opId, backupRoot: outcome.result.backupRoot,
        rollback: { tool: 'rollback_operation', args: { opId: outcome.result.opId } },
        diagnostics: [...envelope.diagnostics, ...outcome.result.diagnostics, ...reread.diagnostics] };
}
function matchesAddress(address, event) {
    if (address.chr !== event.chrId && address.chr.toLowerCase() !== event.chrId.toLowerCase())
        return false;
    if (address.animId === undefined && address.eventIndex === undefined)
        return true;
    if (address.animId !== event.animId)
        return false;
    if (address.eventIndex !== undefined && address.eventIndex !== event.eventIndex)
        return false;
    if (address.taeEntryIndex !== undefined && address.taeEntryIndex !== event.taeEntryIndex)
        return false;
    if (address.taeEntryId !== undefined && address.taeEntryId !== event.taeEntryId)
        return false;
    if (address.taeEntryName !== undefined
        && address.taeEntryName.toLowerCase() !== event.taeEntryName?.toLowerCase())
        return false;
    if (address.taeGroup !== undefined
        && address.taeGroup.toLowerCase() !== event.taeGroup?.toLowerCase())
        return false;
    return true;
}
function sectionSelectorForAnimation(anim) {
    // The protocol intentionally emits one selector. Prefer the source-local
    // BND4 index, then fall back to the stable id/name/group selectors for
    // envelopes that do not expose an index.
    if (anim.taeEntryIndex !== undefined)
        return { taeEntryIndex: anim.taeEntryIndex };
    if (anim.taeEntryId !== undefined)
        return { taeEntryId: anim.taeEntryId };
    if (anim.taeEntryName !== undefined)
        return { taeEntryName: anim.taeEntryName };
    if (anim.taeGroup !== undefined)
        return { taeGroup: anim.taeGroup };
    return {};
}
function projectActions(chrId, animations) {
    return animations.map(anim => ({ chrId, animId: anim.animId, code: formatAnimCode(anim.animId),
        ...(anim.taeEntryIndex === undefined ? {} : { taeEntryIndex: anim.taeEntryIndex }),
        ...(anim.taeEntryId === undefined ? {} : { taeEntryId: anim.taeEntryId }),
        ...(anim.taeEntryName === undefined ? {} : { taeEntryName: anim.taeEntryName }),
        ...(anim.taeGroup === undefined ? {} : { taeGroup: anim.taeGroup }),
        ...(anim.eventsTruncated === undefined ? {} : { eventsTruncated: anim.eventsTruncated }),
        address: formatActionAddress({ chr: chrId, animId: anim.animId, ...sectionSelectorForAnimation(anim) }),
        eventCount: anim.eventCount ?? anim.events?.length ?? 0 }));
}
function projectEvents(chrId, animations) {
    const out = [];
    for (const anim of animations) {
        if (anim.animId === undefined)
            continue;
        const code = formatAnimCode(anim.animId);
        for (let index = 0; index < (anim.events ?? []).length; index += 1) {
            const event = anim.events[index];
            const schemaShapeValid = Array.isArray(event.templateFields) && event.templateFields.every(field => (field !== null && typeof field === 'object' && typeof field.name === 'string' && field.name.length > 0
                && validTaeEnumEntries(field.enumEntries)));
            const startTime = typeof event.startTime === 'number' && Number.isFinite(event.startTime) ? event.startTime : 0;
            const endTime = typeof event.endTime === 'number' && Number.isFinite(event.endTime) ? event.endTime : startTime;
            const sectionSelector = sectionSelectorForAnimation(anim);
            const canonicalAddress = formatActionAddress({
                chr: chrId,
                animId: anim.animId,
                eventIndex: index,
                ...sectionSelector
            });
            const uri = canonicalAddress.startsWith('action://')
                ? canonicalAddress
                : `action://${chrId}/${code}/e${String(index)}`;
            out.push({
                chrId,
                animId: anim.animId,
                code,
                eventIndex: index,
                uri,
                address: canonicalAddress,
                eventTypeId: typeof event.eventTypeId === 'number' ? event.eventTypeId : 0,
                ...(anim.taeEntryIndex === undefined ? {} : { taeEntryIndex: anim.taeEntryIndex }),
                ...(anim.taeEntryId === undefined ? {} : { taeEntryId: anim.taeEntryId }),
                ...(anim.taeEntryName === undefined ? {} : { taeEntryName: anim.taeEntryName }),
                ...(anim.taeGroup === undefined ? {} : { taeGroup: anim.taeGroup }),
                ...(typeof event.typeName === 'string' && event.typeName.length > 0 ? { typeName: event.typeName } : {}),
                ...(typeof event.schemaBankId === 'number' ? { schemaBankId: event.schemaBankId } : {}),
                ...(typeof event.schemaVariant === 'string' ? { schemaVariant: event.schemaVariant } : {}),
                ...(typeof event.parameterDecoded === 'boolean' ? { parameterDecoded: event.parameterDecoded && schemaShapeValid } : {}),
                ...(typeof event.parameterTailLength === 'number' ? { parameterTailLength: event.parameterTailLength } : {}),
                startTime,
                endTime,
                startFrame: frameFromSeconds(startTime),
                endFrame: frameFromSeconds(endTime),
                decodeStatus: event.parameterDecoded === true && schemaShapeValid
                    ? 'decoded'
                    : typeof event.parameterBytesHex === 'string' && event.parameterBytesHex.length > 0
                        ? 'unknown'
                        : 'partial',
                raw: {
                    eventTypeId: typeof event.eventTypeId === 'number' ? event.eventTypeId : 0,
                    startTime,
                    endTime,
                    ...(typeof event.parameterBytesHex === 'string' && event.parameterBytesHex.length > 0
                        ? { parameterBytesHex: event.parameterBytesHex }
                        : {})
                },
                ...(Array.isArray(event.templateFields)
                    ? {
                        fields: event.templateFields
                            .filter((field) => (field !== null && typeof field === 'object' && typeof field.name === 'string' && field.name.length > 0))
                            .map((field) => ({
                            // `name` is what the layout decoder reports and what the desktop UI shows;
                            // `fieldName` is what mutate_tae_event_fields accepts. A caller that read the
                            // write-side key off a read got undefined and wrote nothing, so both are returned
                            // with the same value.
                            name: field.name,
                            fieldName: field.name,
                            value: parseScalar(field.value),
                            ...(typeof field.kind === 'string' ? { kind: field.kind } : {}),
                            ...(typeof field.index === 'number' ? { index: field.index } : {}),
                            ...(typeof field.type === 'string' ? { type: field.type } : {}),
                            ...(typeof field.offset === 'number' ? { offset: field.offset } : {}),
                            ...(typeof field.size === 'number' ? { size: field.size } : {}),
                            ...(typeof field.isPadding === 'boolean' ? { isPadding: field.isPadding } : {}),
                            ...(typeof field.assert === 'number' ? { assert: field.assert } : {}),
                            ...(typeof field.assertValid === 'boolean' ? { assertValid: field.assertValid } : {}),
                            ...(Array.isArray(field.enumEntries) ? { enumEntries: field.enumEntries } : {}),
                            ...(typeof field.rawValue === 'number' ? { rawValue: field.rawValue } : {}),
                            ...(typeof field.displayValue === 'string' ? { displayValue: field.displayValue } : {})
                        }))
                    }
                    : {}),
                ...(typeof event.parameterBytesHex === 'string' && event.parameterBytesHex.length > 0
                    ? { parameterBytesHex: event.parameterBytesHex }
                    : {})
            });
        }
    }
    return out.sort((a, b) => ((a.taeEntryIndex ?? -1) - (b.taeEntryIndex ?? -1)
        || a.animId - b.animId
        || a.eventIndex - b.eventIndex));
}
function parseScalar(value) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return value;
    return String(value ?? '');
}
async function readTaeEnvelope(edit, filePath, addresses, nativePage) {
    const requested = (addresses ?? []).map(address => parseActionAddress(address)).filter((address) => address !== null && address.animId !== undefined);
    const nativeQueries = [...new Map(requested.map(address => [JSON.stringify([address.animId, address.taeEntryIndex, address.taeEntryId, address.taeEntryName, address.taeGroup]), address])).values()];
    const nativeOptions = (address) => ({ animId: address.animId,
        ...(address.taeEntryIndex === undefined ? {} : { taeEntryIndex: address.taeEntryIndex }),
        ...(address.taeEntryId === undefined ? {} : { taeEntryId: address.taeEntryId }),
        ...(address.taeEntryName === undefined ? {} : { taeEntryName: address.taeEntryName }),
        ...(address.taeGroup === undefined ? {} : { taeGroup: address.taeGroup }) });
    const result = await runBridge({
        command: 'read-tae-document',
        filePath,
        resourceUri: pathToFileURL(filePath).href,
        allowedRoots: edit.allowedRoots(),
        ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {}),
        timeoutMs: 120_000,
        commandOptions: nativeQueries[0] ? nativeOptions(nativeQueries[0]) : nativePage ?? { animationPage: 0, animationPageSize: 64 }
    });
    const diagnostics = asDiagnostics(result.diagnostics);
    if (result.parseStatus === 'failed' || !result.data || !Array.isArray(result.data.animations)) {
        return {
            ok: false,
            result: {
                ok: false,
                error: diagnostics.some(d => d.message.includes('ACTION_TAE_ANIMATION_ID_AMBIGUOUS'))
                    ? { code: 'TAE_EVENT_AMBIGUOUS', message: diagnostics.find(d => d.message.includes('ACTION_TAE_ANIMATION_ID_AMBIGUOUS')).message }
                    : { code: 'TAE_READ_FAILED', message: `无法读取 TAE 文档：${filePath}` },
                diagnostics
            }
        };
    }
    for (const address of nativeQueries.slice(1)) {
        const next = await runBridge({
            command: 'read-tae-document', filePath, allowedRoots: edit.allowedRoots(), timeoutMs: 120000,
            commandOptions: nativeOptions(address), ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {})
        });
        if (next.parseStatus === 'failed' || !next.data?.animations || next.data.sourceHash !== result.data.sourceHash
            || next.data.outerFileHash !== result.data.outerFileHash
            || next.data.identityProjectionVersion !== result.data.identityProjectionVersion)
            return { ok: false, result: { ok: false, error: { code: 'TAE_ACTION_READ_INCOMPLETE', message: '目标动作查询失败或原生来源/读取器版本在查询间改变。' }, diagnostics: asDiagnostics(next.diagnostics) } };
        for (const animation of next.data.animations) {
            const key = (value) => JSON.stringify([value?.animId, value?.taeEntryIndex, value?.taeEntryId, value?.taeEntryName, value?.taeGroup]);
            if (!result.data.animations.some(existing => key(existing) === key(animation)))
                result.data.animations.push(animation);
        }
    }
    const invalidAnimationIndex = result.data.animations.findIndex((anim) => {
        if (anim === null || typeof anim !== 'object')
            return true;
        const animId = anim.animId;
        return typeof animId !== 'number' || !Number.isSafeInteger(animId) || animId < 0;
    });
    if (invalidAnimationIndex >= 0) {
        const invalidAnim = result.data.animations[invalidAnimationIndex];
        return {
            ok: false,
            result: {
                ok: false,
                error: {
                    code: 'TAE_ANIM_ID_INVALID',
                    message: `原生 TAE 动画 ${invalidAnimationIndex} 的 animId 必须是非负 safe integer：${String(invalidAnim?.animId)}`
                },
                diagnostics
            }
        };
    }
    for (let index = 0; index < result.data.animations.length; index++) {
        if (nativePage)
            break;
        const animation = result.data.animations[index];
        if (typeof animation.animId !== 'number')
            continue;
        const selected = requested.some((address) => address.animId === animation.animId
            && (address.taeEntryIndex === undefined || address.taeEntryIndex === animation.taeEntryIndex)
            && (address.taeEntryId === undefined || address.taeEntryId === animation.taeEntryId)
            && (address.taeEntryName === undefined || address.taeEntryName === animation.taeEntryName)
            && (address.taeGroup === undefined || address.taeGroup === animation.taeGroup));
        if (nativeQueries.length > 0 && animation.eventsTruncated !== true)
            continue;
        if (!selected && animation.eventsTruncated !== true)
            continue;
        const full = await runBridge({
            command: 'read-tae-document', filePath, allowedRoots: edit.allowedRoots(), timeoutMs: 120000,
            commandOptions: { animId: animation.animId,
                ...(typeof animation.taeEntryIndex === 'number' ? { taeEntryIndex: animation.taeEntryIndex } : {}) },
            ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {})
        });
        if (full.parseStatus === 'failed' || !full.data?.animations?.[0]
            || full.data.sourceHash !== result.data.sourceHash || full.data.outerFileHash !== result.data.outerFileHash)
            return { ok: false, result: { ok: false,
                    error: { code: 'TAE_ACTION_READ_INCOMPLETE', message: '动作完整读取失败或来源在读取期间变化。' }, diagnostics: asDiagnostics(full.diagnostics) } };
        result.data.animations[index] = full.data.animations[0];
    }
    const chrId = extractChrId(filePath);
    if (!chrId) {
        return {
            ok: false,
            result: {
                ok: false,
                error: { code: 'TAE_CHR_ID_UNKNOWN', message: `无法从路径提取角色 id：${filePath}` },
                diagnostics
            }
        };
    }
    const animations = result.data.animations.map((anim) => {
        const animId = asFinite(anim.animId);
        return {
            ...(animId === undefined ? {} : { animId }),
            ...(typeof anim.hkxName === 'string' ? { hkxName: anim.hkxName } : {}),
            ...(typeof anim.taeEntryIndex === 'number' ? { taeEntryIndex: anim.taeEntryIndex } : {}),
            ...(typeof anim.taeEntryId === 'number' ? { taeEntryId: anim.taeEntryId } : {}),
            ...(typeof anim.taeEntryName === 'string' ? { taeEntryName: anim.taeEntryName } : {}),
            ...(typeof anim.taeGroup === 'string' ? { taeGroup: anim.taeGroup } : {}),
            ...(typeof anim.eventCount === 'number' && Number.isSafeInteger(anim.eventCount) && anim.eventCount >= 0 ? { eventCount: anim.eventCount } : {}),
            ...(typeof anim.eventsTruncated === 'boolean' ? { eventsTruncated: anim.eventsTruncated } : {}),
            events: Array.isArray(anim.events) ? anim.events.map((event) => {
                const startTime = asFinite(event.startTime);
                const endTime = asFinite(event.endTime);
                const eventTypeId = asFinite(event.eventTypeId);
                return {
                    ...(startTime === undefined ? {} : { startTime }),
                    ...(endTime === undefined ? {} : { endTime }),
                    ...(eventTypeId === undefined ? {} : { eventTypeId }),
                    ...(typeof event.typeName === 'string' ? { typeName: event.typeName } : {}),
                    ...(Array.isArray(event.templateFields)
                        ? { templateFields: event.templateFields }
                        : {}),
                    ...(typeof event.parameterBytesHex === 'string' ? { parameterBytesHex: event.parameterBytesHex } : {}),
                    ...(typeof event.parameterDecoded === 'boolean' ? { parameterDecoded: event.parameterDecoded } : {}),
                    ...(typeof event.schemaBankId === 'number' ? { schemaBankId: event.schemaBankId } : {}),
                    ...(typeof event.schemaVariant === 'string' ? { schemaVariant: event.schemaVariant } : {}),
                    ...(typeof event.parameterTailLength === 'number' ? { parameterTailLength: event.parameterTailLength } : {})
                };
            }) : []
        };
    });
    return {
        ok: true,
        chrId,
        readerSchemaRevision: typeof result.data.identityProjectionVersion === 'number' ? result.data.identityProjectionVersion : 0,
        ...(result.data.sourceHash ? { sourceHash: result.data.sourceHash } : {}),
        ...(result.data.outerFileHash ? { outerFileHash: result.data.outerFileHash } : {}),
        ...(result.data.containerSourceHash ? { containerSourceHash: result.data.containerSourceHash } : {}),
        ...(typeof result.data.animationCount === 'number' ? { animationCount: result.data.animationCount } : {}),
        ...(typeof result.data.totalEventCount === 'number' ? { totalEventCount: result.data.totalEventCount } : {}),
        ...(typeof result.data.animationsTruncated === 'boolean' ? { animationsTruncated: result.data.animationsTruncated } : {}),
        ...(typeof result.data.taeEntryCount === 'number' ? { taeEntryCount: result.data.taeEntryCount } : {}),
        ...(Array.isArray(result.data.taeEntries) ? { taeEntries: result.data.taeEntries } : {}),
        animations,
        diagnostics
    };
}
function extractChrId(filePath) {
    const match = /(?:^|[/\\])c(\d{4})(?:[./\\]|$)/i.exec(filePath);
    return match ? `c${match[1]}`.toLowerCase() : null;
}
function asFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function asDiagnostics(items) {
    return items.map((item) => ({
        severity: item.severity === 'warning' || item.severity === 'info' ? item.severity : 'error',
        code: item.code,
        message: item.message, ...(item.details === undefined ? {} : { details: item.details })
    }));
}
async function sha256Of(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}
//# sourceMappingURL=taeEdit.js.map