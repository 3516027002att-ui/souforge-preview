import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createOpaqueCursor, defaultReadSessionManager, parseOpaqueCursor, TAE_ANIMATION_PAGE_SIZE } from '@soulforge/shared';
import { makeFileResourceUri, makeWorkspaceRelativePath } from '../workspace/resourceUri.js';
/** Match the existing Desktop native animation page, not a new event quota. */
export const TAE_BROWSE_ANIMATION_PAGE_SIZE = TAE_ANIMATION_PAGE_SIZE;
// Metadata has the same lifetime as its shared session, including invalidation
// and expiry. No second strong session table or independently growing cache.
const pageStates = new WeakMap();
function failure(code, message, diagnostics = []) {
    return { ok: false, error: { code, message }, diagnostics };
}
function actionKey(action) {
    return JSON.stringify([action.taeEntryIndex, action.taeEntryId, action.taeEntryName, action.taeGroup, action.animId]);
}
function nativeEventsTruncated(page) {
    const counts = new Map();
    for (const event of page.events)
        counts.set(actionKey(event), (counts.get(actionKey(event)) ?? 0) + 1);
    return page.actions.some(action => action.eventsTruncated === true || (counts.get(actionKey(action)) ?? 0) < action.eventCount);
}
function expectedVersionMatches(input, page) {
    return (input.expectedSourceHash === undefined || input.expectedSourceHash === page.outerFileHash)
        && (input.expectedReaderSchemaRevision === undefined || input.expectedReaderSchemaRevision === page.readerSchemaRevision);
}
function sameNativeSnapshot(left, right) {
    return left.outerFileHash === right.outerFileHash && left.sourceHash === right.sourceHash
        && left.containerSourceHash === right.containerSourceHash && left.readerSchemaRevision === right.readerSchemaRevision;
}
/**
 * Give a page a stable outer identity.
 *
 * A TAE aggregated from an anibnd reports the aggregate `sourceHash` but no `outerFileHash`; the
 * browse session still needs one identity to bind cursors and to compare `expectedSourceHash`
 * (which callers copy from the search result). Falling back to `sourceHash` keeps those two in
 * the same domain instead of rejecting every anibnd-backed container.
 */
function establishOuterIdentity(page) {
    if (!page.outerFileHash && page.sourceHash)
        page.outerFileHash = page.sourceHash;
    return Boolean(page.outerFileHash);
}
/**
 * Byte-level staleness guard for the browse session.
 *
 * A DCX container reports the hash of its decompressed payload as `outerFileHash`, so comparing it
 * with the raw `.dcx` bytes would reject every compressed source (which is nearly every Sekiro
 * animation container). For those files the Bridge-provided hashes remain the identity; loose,
 * uncompressed files still get the byte comparison.
 */
async function physicalSnapshotMatches(filePath, outerFileHash) {
    let bytes;
    try {
        bytes = await readFile(filePath);
    }
    catch {
        return false;
    }
    if (bytes.length >= 4 && bytes[0] === 0x44 && bytes[1] === 0x43 && bytes[2] === 0x58 && bytes[3] === 0x00)
        return true;
    return createHash('sha256').update(bytes).digest('hex') === outerFileHash;
}
/**
 * Browse bounded native animation previews. Each shared session retains one
 * immutable native page; only following its boundary cursor loads the next.
 * This does not hydrate event tails or build an all-document event array.
 */
export async function readTaeBrowse(input) {
    if (input.cursor !== undefined && input.offset !== undefined)
        return failure('TAE_CURSOR_SCOPE_MISMATCH', '续页只传 cursor，不同时传 offset。');
    if (input.offset !== undefined && input.offset !== 0)
        return failure('TAE_CURSOR_INVALID', '未指定动作的 TAE 浏览须使用 cursor 续页；初始 offset 只能为 0。');
    const relativePath = makeWorkspaceRelativePath(input.edit.session.layers.overlayRoot, input.filePath);
    const sourceUri = makeFileResourceUri(relativePath);
    const queryScope = `tae-browse:${sourceUri}`;
    const workspaceId = input.edit.session.meta.workspaceId;
    try {
        let session;
        let state;
        let cursor;
        if (input.cursor !== undefined) {
            const payload = parseOpaqueCursor(input.cursor);
            if (payload.domain !== 'tae' || payload.scope !== queryScope)
                return failure('TAE_CURSOR_SCOPE_MISMATCH', 'TAE 浏览 cursor 与当前文件或读取范围不匹配。');
            const existing = defaultReadSessionManager.getSession(payload.sessionId);
            if (!existing)
                return failure('STALE_READ_CURSOR', 'TAE 浏览会话已过期：cursor 是进程内会话游标，只对产生它的进程有效（跨进程或会话结束后不可能命中），请从第一页重新读取。');
            const existingState = pageStates.get(existing);
            if (!existingState || existing.domain !== 'tae' || existing.queryScope !== queryScope || existing.workspaceId !== workspaceId)
                return failure('TAE_CURSOR_SCOPE_MISMATCH', 'TAE 浏览 cursor 不属于当前工作区或读取会话。');
            if (!Number.isSafeInteger(payload.offset) || payload.offset < 0 || payload.offset > existing.items.length)
                return failure('TAE_CURSOR_INVALID', 'TAE 浏览 cursor 的事件窗口位置无效。');
            state = existingState;
            if (payload.sourceHash !== existing.sourceVersion.sourceHash || payload.sourceHash !== state.page.outerFileHash
                || !await physicalSnapshotMatches(input.filePath, state.page.outerFileHash))
                return failure('STALE_READ_CURSOR', 'TAE 来源已变化，请从第一页重新读取。');
            if (!expectedVersionMatches(input, state.page))
                return failure('TAE_SOURCE_VERSION_CHANGED', 'TAE 来源或读取器版本已变化，请重新读取。', state.page.diagnostics);
            session = existing;
            cursor = input.cursor;
            if (payload.offset === existing.items.length && state.page.animationsTruncated) {
                const loaded = await input.loadPage(state.animationPage + 1, TAE_BROWSE_ANIMATION_PAGE_SIZE);
                if (!loaded.ok)
                    return loaded;
                if (!establishOuterIdentity(loaded) || !sameNativeSnapshot(state.page, loaded) || !expectedVersionMatches(input, loaded)
                    || !await physicalSnapshotMatches(input.filePath, loaded.outerFileHash))
                    return failure('TAE_SOURCE_VERSION_CHANGED', 'TAE 原生来源或读取器版本在分页期间变化。', loaded.diagnostics);
                const created = createPageSession(loaded, state.animationPage + 1, state.previewOffset + existing.items.length, state.previousEventsTruncated || nativeEventsTruncated(state.page), workspaceId, sourceUri, queryScope);
                session = created.session;
                state = created.state;
                cursor = created.cursor;
            }
        }
        else {
            const loaded = await input.loadPage(0, TAE_BROWSE_ANIMATION_PAGE_SIZE);
            if (!loaded.ok)
                return loaded;
            if (!establishOuterIdentity(loaded) || !expectedVersionMatches(input, loaded)
                || !await physicalSnapshotMatches(input.filePath, loaded.outerFileHash))
                return failure('TAE_SOURCE_VERSION_CHANGED', 'TAE 浏览需要与当前文件一致的原生物理快照哈希。', loaded.diagnostics);
            const created = createPageSession(loaded, 0, 0, false, workspaceId, sourceUri, queryScope);
            session = created.session;
            state = created.state;
            cursor = created.cursor;
        }
        const requestedSize = Number.isSafeInteger(input.pageSize) && input.pageSize >= 1 && input.pageSize <= 128 ? input.pageSize : 32;
        const pageSize = Math.max(1, Math.min(requestedSize, Math.floor(24000 / state.maximumEventBytes)));
        const window = defaultReadSessionManager.resolvePage(cursor, state.page.outerFileHash, pageSize);
        const events = window.items;
        const hasMore = window.hasMore || state.page.animationsTruncated;
        const nextCursor = window.nextCursor ?? (state.page.animationsTruncated ? createOpaqueCursor({
            sessionId: session.sessionId, offset: session.items.length, sourceHash: state.page.outerFileHash, domain: 'tae', scope: queryScope
        }) : null);
        const eventsTruncated = state.previousEventsTruncated || nativeEventsTruncated(state.page);
        const actions = projectBrowseActions(state.page, events, window.offset, pageSize, relativePath);
        const preview = projectBrowsePreview(state.page);
        const { animationsTruncated: _nativeMore, actions: _actions, events: _events, ...metadata } = state.page;
        return {
            ...metadata, filePath: input.filePath, events, actions, preview, eventsTruncated,
            status: hasMore || eventsTruncated ? 'partial' : 'complete',
            pagination: { returnedCount: events.length, totalCount: null, offset: state.previewOffset + window.offset,
                hasMore, nextCursor, totalPages: null },
            nativePagination: { animationPage: state.animationPage, animationPageSize: TAE_BROWSE_ANIMATION_PAGE_SIZE,
                returnedCount: state.page.actions.length, totalCount: state.page.animationCount ?? null, hasMore: state.page.animationsTruncated }
        };
    }
    catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'TAE_READ_FAILED';
        return failure(code, error instanceof Error ? error.message : String(error));
    }
}
function createPageSession(page, animationPage, previewOffset, previousEventsTruncated, workspaceId, sourceUri, queryScope) {
    const session = defaultReadSessionManager.createSession({ workspaceId,
        sourceVersion: { sourceUri, sourceHash: page.outerFileHash }, domain: 'tae', queryScope, items: page.events.slice() });
    const state = { page, animationPage, previewOffset, previousEventsTruncated,
        maximumEventBytes: page.events.reduce((maximum, event) => Math.max(maximum, Buffer.byteLength(JSON.stringify(event), 'utf8')), 1) };
    pageStates.set(session, state);
    return { session, state, cursor: createOpaqueCursor({ sessionId: session.sessionId, offset: 0,
            sourceHash: page.outerFileHash, domain: 'tae', scope: queryScope }) };
}
function projectBrowseActions(page, events, offset, pageSize, relativePath) {
    const delivered = new Map();
    for (const event of events) {
        const key = actionKey(event);
        const siblings = delivered.get(key) ?? [];
        siblings.push(event);
        delivered.set(key, siblings);
    }
    return page.actions.flatMap(action => {
        const siblings = delivered.get(actionKey(action)) ?? [];
        // Keep zero-event actions visible on the native page's first window.
        if (siblings.length === 0 && !(offset === 0 && action.eventCount === 0))
            return [];
        const prefix = page.events.slice(0, offset + events.length).filter(event => actionKey(event) === actionKey(action));
        const contiguous = prefix.every((event, index) => event.eventIndex === index);
        const nextOffset = contiguous ? prefix.length : 0;
        const eventsComplete = contiguous && prefix.length === action.eventCount;
        const hasMore = !eventsComplete;
        return [{ ...action, eventsComplete, eventsTruncated: action.eventsTruncated === true || hasMore,
                pagination: { totalCount: action.eventCount, returnedCount: siblings.length, offset: siblings[0]?.eventIndex ?? 0, hasMore,
                    ...(hasMore ? { nextRead: { tool: 'read_tae_events', args: {
                                file: relativePath, addresses: [action.address], offset: nextOffset, pageSize,
                                expectedSourceHash: page.outerFileHash, expectedReaderSchemaRevision: page.readerSchemaRevision
                            } } } : {}) } }];
    });
}
/** The compact preview rides along with the page; it is bounded so the page itself stays bounded. */
const PREVIEW_ACTION_BUDGET_BYTES = 10 * 1024;
const PREVIEW_TYPE_LIMIT = 16;
const PREVIEW_FIRST_EVENTS = 8;
function projectBrowsePreview(page) {
    const counts = new Map();
    const typesByAction = new Map();
    for (const event of page.events) {
        const entry = counts.get(event.eventTypeId) ?? { ...(event.typeName ? { typeName: event.typeName } : {}), count: 0 };
        entry.count += 1;
        if (entry.typeName === undefined && event.typeName)
            entry.typeName = event.typeName;
        counts.set(event.eventTypeId, entry);
        const key = actionKey(event);
        const types = typesByAction.get(key) ?? new Set();
        types.add(event.eventTypeId);
        typesByAction.set(key, types);
    }
    const orderedTypes = [...counts.entries()].sort((left, right) => right[1].count - left[1].count || left[0] - right[0]);
    const eventTypeCounts = orderedTypes.slice(0, PREVIEW_TYPE_LIMIT).map(([eventTypeId, entry]) => ({
        eventTypeId, ...(entry.typeName ? { typeName: entry.typeName } : {}), count: entry.count
    }));
    const firstEvents = page.events.slice(0, PREVIEW_FIRST_EVENTS).map((event) => ({
        eventIndex: event.eventIndex,
        ...(event.address ?? event.uri ? { address: event.address ?? event.uri } : {}),
        eventTypeId: event.eventTypeId,
        ...(event.typeName ? { typeName: event.typeName } : {}),
        startTime: event.startTime,
        endTime: event.endTime
    }));
    const actions = [];
    let bytes = 0;
    for (const action of page.actions) {
        const eventTypeIds = [...(typesByAction.get(actionKey(action)) ?? new Set())].sort((left, right) => left - right);
        const row = { code: action.code, address: action.address, eventCount: action.eventCount, eventTypeIds };
        const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
        if (actions.length > 0 && bytes + rowBytes > PREVIEW_ACTION_BUDGET_BYTES)
            break;
        bytes += rowBytes;
        actions.push(row);
    }
    const remainingActions = page.actions.length - actions.length;
    return {
        animationCount: page.actions.length,
        eventCount: page.events.length,
        eventCountComplete: !nativeEventsTruncated(page),
        eventTypeCounts,
        ...(orderedTypes.length > eventTypeCounts.length ? { eventTypesTruncated: true } : {}),
        firstEvents,
        actions,
        ...(remainingActions > 0 ? { actionsTruncated: true, remainingActions } : {})
    };
}
//# sourceMappingURL=taeBrowse.js.map