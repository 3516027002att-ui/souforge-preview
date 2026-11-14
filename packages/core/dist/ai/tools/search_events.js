import { asNumber, asOptionalString, asRecord, eventSearchSnapshotHash, fail, indexedEventSearchCoverage, nativeEventSearchSnapshotHash, ok, ragSearchFallback, requireEditSession, resolveIndexedResourceFile, resolveStatelessCursorPage, searchScopedNativeEvents } from '../toolRegistrySupport.js';
import { readScopedEventSearchCursor } from '.././scopedEventSearchCursor.js';
import { createOpaqueCursor, defaultReadSessionManager, parseOpaqueCursor } from '@soulforge/shared';
import { isActiveSemanticSource } from '../../workspace/resourceKinds.js';
import * as emevdEdit from '../../editing/emevdEdit.js';
import { randomUUID } from 'node:crypto';
import { cursorIdentity } from '../../workspace/cursorIdentity.js';
import { loadWorkspaceEventInstructionIndex } from '../eventArgumentIndexService.js';
import { eventInstructionIndexDiagnostics, searchEventInstructionReferences, ENTITY_ARG_NAMES } from '../../references/eventInstructionIndex.js';
import { assessParameterizedEntityCoverage } from '../../references/parameterizedEntityCoverage.js';
/**
 * 事件参数索引的 `negativeConclusionAllowed` 只表示**结构完整**（47 个文件都读出、
 * 没有未知/解码失败指令），不表示“参数化实体实参也看得见”。本查询相关指令类若存在
 * 无法归属的参数化实参，任意一条都可能指向查询目标，否定结论必须降级为 inconclusive；
 * 参数化调用属于其它指令类时与本次查询无关，否定仍成立并写明理由。
 */
function buildNegativeConclusion(input) {
    const { assessment } = input;
    const blockedReasons = [];
    const caveats = [];
    const scopeName = input.sourceUri === undefined ? '工作区事件索引' : `${input.sourceUri} 的事件索引`;
    const listed = (names) => names.length <= 5
        ? names.join('、')
        : `${names.slice(0, 5).join('、')} 等 ${names.length} 类`;
    if (assessment.blocksNegative) {
        const names = assessment.relevantInstructions.map((entry) => entry.name);
        blockedReasons.push(assessment.scope === 'any'
            ? `EVENT_INDEX_PARAMETERIZED_INSTRUCTIONS:查询没有限定指令类，${scopeName}中有 ${assessment.relevantCount} 条调用的实体实参来自公共事件形参（X<offset>_<width>）（${listed(names)}），无法归属到具体实体；任意一条都可能指向查询目标，因此“没有字面量命中”不能当作“不存在”。`
            : `EVENT_INDEX_PARAMETERIZED_INSTRUCTIONS:本次查询相关的指令类（${listed(names)}）在${scopeName}中有 ${assessment.relevantCount} 条调用的实体实参来自公共事件形参（X<offset>_<width>），无法归属到具体实体；任意一条都可能指向查询目标，因此“没有字面量命中”不能当作“不存在”。`);
        caveats.push('参数化调用无法归属到具体实体，既不算证据也不算反证；本次否定结论已降级为 inconclusive。');
        return { verdict: 'inconclusive', negativeConclusionAllowed: false, blockedReasons, caveats };
    }
    const label = input.instructionName ?? input.instructionContains;
    if (label !== undefined) {
        const unrelated = assessment.unrelatedInstructions.map((entry) => entry.name);
        caveats.push(`本次查询的指令类（${label}）在${scopeName}中没有参数化实体实参`
            + (assessment.totalCount > 0
                ? `；索引里 ${assessment.totalCount} 条参数化调用属于其他指令类${unrelated.length > 0 ? `（${listed(unrelated)}）` : ''}，与本次查询无关，因此否定结论仍成立（它们仍然既不算证据也不算反证）。`
                : '，否定结论仍成立。'));
    }
    return {
        verdict: input.structuralNegativeAllowed ? 'negative-allowed' : 'inconclusive',
        negativeConclusionAllowed: input.structuralNegativeAllowed,
        blockedReasons,
        caveats
    };
}
/** search_events: one domain tool declaration, schema and handler. */
export function createSearchEventsTool() {
    return {
        name: 'search_events',
        description: 'Search parsed native event symbols and instruction names. '
            + 'query matches the indexed event projection by event id, event name, text tokens and decoded EMEDF instruction name, '
            + 'so an exact instruction name such as DisplayMinibossHealthBar finds the events that carry it (for example {query:"DisplayMinibossHealthBar"} → event 11105800 in m11_00_00_00); '
            + 'the indexed event projection stores instructions as bank:<n> id:<n>, which is decoded against EMEDF before matching. '
            + 'If the projection has no hit, a precise English instruction name or numeric ID is additionally scanned natively across every active EMEVD; query never matches arbitrary DSL text. '
            + 'For exact lookup pass file + eventId; for current native instructions inside a located file pass file + query (instruction name or numeric ID). '
            + 'For argument-value search pass entityId (decoded entityId/targetEntityId argument) or argName:"entityId" + argValue, and optionally instruction; '
            + 'instruction is an exact EMEDF instruction-name filter (case-insensitive), and query may additionally be an instruction-name substring in that branch. '
            + 'This uses the workspace event-argument index over every indexed EMEVD (for example {entityId:1100800, instruction:"DisplayMinibossHealthBar"}) '
            + 'and returns event id + file + the decoded instruction. negativeConclusionAllowed is query-scoped: it is false when event files are incomplete '
            + 'or when calls of the queried instruction class take their entity args from common event parameters (X<offset>_<width>), because those calls cannot be '
            + 'attributed and may target the query; a zero result is then inconclusive (verdict + blockedReasons), never proof of absence. '
            + 'Global indexed results are candidates with explicit coverage, not exhaustive native search; '
            + 'fuzzy queries return candidates and are not a substitute for native reads. For Chinese behavior terms '
            + 'such as 血条、落雷、掉落 or 不攻击, use search_event_reference in parallel, then verify the '
            + 'candidate instruction against this workspace event and EMEDF.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { query: 'string?', file: 'string?', eventId: 'number?', limit: 'number?', cursor: 'string?', entityId: 'number?', instruction: 'string?', offset: 'number?', argName: 'string?', argValue: 'number?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const file = asOptionalString(value.file);
            const eventId = value.eventId === undefined ? undefined : asNumber(value.eventId, Number.NaN);
            const limit = Math.max(1, Math.min(6, Math.trunc(asNumber(value.limit, 6))));
            const cursor = asOptionalString(value.cursor)?.trim();
            // Argument-value search (F3): "which event carries entityId=1100800" was not
            // answerable before — the index only tokenized instruction names and the native
            // scan could not filter by argument name. This branch reads the workspace
            // event-argument index (one full pass over every indexed EMEVD) and answers by
            // decoded *literal* entity arguments. Parameterized slots (X0_4) are never
            // attributed to a concrete entity; they are counted in coverage instead.
            const argName = asOptionalString(value.argName)?.trim();
            const hasArgFilter = argName !== undefined || value.argValue !== undefined;
            if (value.entityId !== undefined || value.instruction !== undefined || hasArgFilter) {
                let filterEntityId = value.entityId === undefined ? undefined : asNumber(value.entityId, Number.NaN);
                if (hasArgFilter) {
                    if (!argName || value.argValue === undefined) {
                        return fail('INVALID_INPUT', 'search_events 的 argName 与 argValue 必须成对出现。');
                    }
                    if (!ENTITY_ARG_NAMES.includes(argName)) {
                        return fail('INVALID_INPUT', `事件参数索引只保留实体参数（${ENTITY_ARG_NAMES.join(' / ')}）；${argName} 没有索引，不能用它做参数过滤。`);
                    }
                    const argValue = asNumber(value.argValue, Number.NaN);
                    if (!Number.isSafeInteger(argValue) || argValue <= 0) {
                        return fail('INVALID_INPUT', 'search_events 的 argValue 必须是安全正整数。');
                    }
                    filterEntityId = argValue;
                }
                if (filterEntityId !== undefined && (!Number.isSafeInteger(filterEntityId) || filterEntityId <= 0)) {
                    return fail('INVALID_INPUT', 'search_events 的 entityId 必须是安全正整数。');
                }
                const instruction = asOptionalString(value.instruction)?.trim();
                const queryText = typeof value.query === 'string' && value.query.trim() ? value.query.trim() : undefined;
                if (cursor) {
                    return fail('INVALID_INPUT', '按参数值搜索不能与 cursor 混用：分页请用 offset。');
                }
                const edit = requireEditSession(context, 'read');
                if (!('session' in edit))
                    return edit;
                const loaded = await loadWorkspaceEventInstructionIndex({
                    workspaceId: ws.workspaceId,
                    ws,
                    edit: edit.session,
                    ...(context.signal ? { signal: context.signal } : {})
                });
                if (!loaded.ok)
                    return fail(loaded.code, loaded.message, loaded.diagnostics);
                let sourceUri;
                if (file !== undefined) {
                    const resolvedFile = resolveIndexedResourceFile(context, file, 'event');
                    if (!resolvedFile.ok)
                        return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
                    sourceUri = resolvedFile.sourceUri;
                }
                const offset = Math.max(0, Math.trunc(asNumber(value.offset, 0)));
                const pageLimit = Math.max(1, Math.min(50, Math.trunc(asNumber(value.limit, 20))));
                // 结构完整（47 文件全部读出）≠ 参数化实参看得见。按“本查询相关指令类”
                // 是否也存在无法归属的调用决定否定结论能否成立。
                const parameterized = assessParameterizedEntityCoverage({
                    files: loaded.index.files,
                    ...(instruction ? { instructionName: instruction } : queryText ? { instructionContains: queryText } : {}),
                    ...(sourceUri === undefined ? {} : { sourceUri })
                });
                const conclusion = buildNegativeConclusion({
                    structuralNegativeAllowed: loaded.index.coverage.structuralNegativeConclusionAllowed,
                    assessment: parameterized,
                    ...(instruction ? { instructionName: instruction } : {}),
                    ...(!instruction && queryText ? { instructionContains: queryText } : {}),
                    ...(sourceUri === undefined ? {} : { sourceUri })
                });
                const filtered = searchEventInstructionReferences(loaded.index, {
                    ...(filterEntityId === undefined ? {} : { entityId: filterEntityId }),
                    ...(instruction ? { instructionName: instruction } : {}),
                    ...(queryText ? { instructionContains: queryText } : {}),
                    ...(eventId === undefined ? {} : { eventId }),
                    ...(sourceUri === undefined ? {} : { sourceUri }),
                    limit: pageLimit,
                    offset
                });
                const matches = filtered.matches.map((reference) => ({
                    sourceUri: reference.sourceUri,
                    ...(reference.mapId === undefined ? {} : { mapId: reference.mapId }),
                    eventId: reference.eventId,
                    eventUri: `event://${reference.mapId ?? 'unknown'}/${reference.eventId}`,
                    instructionIndex: reference.instructionIndex,
                    instruction: {
                        index: reference.instructionIndex,
                        bank: reference.bank,
                        id: reference.id,
                        emedfName: reference.instructionName
                    },
                    entityArg: { name: reference.entityArgName, value: reference.entityId },
                    args: reference.args,
                    // 工具层会按 discovery 投影裁剪自定义字段；statement 是投影白名单里的字段，
                    // 保证即使 agent 侧只保留标准字段，参数值原文也不会消失。
                    statement: `${reference.instructionName}#${reference.instructionIndex}(${Object.entries(reference.args).map(([name, value]) => `${name}=${String(value)}`).join(', ')})`,
                    authority: 'workspace-event-argument-index'
                }));
                return ok({
                    authority: 'workspace-event-argument-index',
                    filterEntityId: filterEntityId ?? null,
                    filterArgName: argName ?? null,
                    filterInstruction: instruction ?? null,
                    filterEventId: eventId ?? null,
                    query: {
                        ...(filterEntityId === undefined ? {} : { entityId: filterEntityId }),
                        ...(instruction ? { instruction } : {}),
                        ...(eventId === undefined ? {} : { eventId }),
                        ...(sourceUri === undefined ? {} : { sourceUri })
                    },
                    coverage: {
                        ...loaded.index.coverage,
                        negativeConclusionAllowed: conclusion.negativeConclusionAllowed,
                        // 保留“结构本身是否完整”，避免把结论许可和索引结构混成一个字段。
                        structuralCompleteness: loaded.index.coverage.status === 'complete'
                    },
                    complete: loaded.index.coverage.status === 'complete',
                    negativeConclusionAllowed: conclusion.negativeConclusionAllowed,
                    verdict: conclusion.verdict,
                    blockedReasons: conclusion.blockedReasons,
                    caveats: conclusion.caveats,
                    parameterizedEntityArgs: {
                        scope: parameterized.scope,
                        relevant: parameterized.relevantCount,
                        total: parameterized.totalCount,
                        instructions: parameterized.relevantInstructions,
                        ...(parameterized.unrelatedInstructions.length === 0
                            ? {}
                            : { unrelatedInstructions: parameterized.unrelatedInstructions }),
                        otherRoleCount: parameterized.otherRoleCount
                    },
                    buildMs: loaded.index.buildMs,
                    total: filtered.total,
                    offset: filtered.offset,
                    limit: filtered.limit,
                    returned: matches.length,
                    truncated: filtered.truncated,
                    matches,
                    diagnostics: eventInstructionIndexDiagnostics(loaded.index),
                    ...(filtered.truncated
                        ? { note: `参数命中 ${filtered.total} 条，本次返回 offset=${filtered.offset} 起的 ${matches.length} 条；用 offset 继续。` }
                        : {})
                });
            }
            if (cursor && eventId !== undefined) {
                return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events 续页不能同时指定 eventId：请只传 cursor，或重新发起搜索。');
            }
            if (cursor) {
                try {
                    const scoped = readScopedEventSearchCursor(cursor, ws.workspaceId);
                    if (scoped) {
                        // Same file and query may be resent with the cursor; only a real change is a scope error.
                        const sameToken = (left, right) => left.trim().toLowerCase() === right.trim().toLowerCase();
                        if (file !== undefined && !sameToken(file, scoped.scope.file)) {
                            return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events 续页的 file 与游标不一致：请只传 cursor，或重新发起搜索。');
                        }
                        if (value.query !== undefined && String(value.query).trim() !== scoped.scope.query) {
                            return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events 续页的 query 与游标不一致：请只传 cursor，或重新发起搜索。');
                        }
                        return searchScopedNativeEvents(context, scoped.scope.file, scoped.scope.query, limit, scoped);
                    }
                }
                catch (error) {
                    return fail(error.code ?? 'INVALID_READ_CURSOR', String(error));
                }
            }
            else if (file && typeof value.query === 'string' && eventId === undefined) {
                return searchScopedNativeEvents(context, file, value.query.trim(), limit);
            }
            if (cursor) {
                let payload;
                try {
                    payload = parseOpaqueCursor(cursor);
                }
                catch (error) {
                    return fail(typeof error.code === 'string'
                        ? error.code
                        : 'INVALID_READ_CURSOR', error instanceof Error ? error.message : 'search_events cursor 无效。');
                }
                if (payload.domain !== 'emevd'
                    || (!payload.scope.startsWith('search-events:') && !payload.scope.startsWith('native-events:'))) {
                    return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events cursor 不属于当前事件搜索范围：请重新发起一次搜索。');
                }
                if (payload.scope.startsWith('native-events:')) {
                    let nativeQuery;
                    try {
                        const scope = JSON.parse(payload.scope.slice('native-events:'.length));
                        // Unbound (pre-v2) cursors carry no workspace digest and are rejected:
                        // a cursor is only a session-local paging token, the agent re-queries.
                        if (!scope || scope.workspaceId !== cursorIdentity(ws.workspaceId))
                            return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events cursor 不属于当前工作区，请重新执行 search_events。');
                        nativeQuery = typeof scope.query === 'string' ? scope.query : '';
                    }
                    catch {
                        return fail('INVALID_READ_CURSOR', 'native search_events cursor 的查询范围无法解析：请重新发起一次搜索。');
                    }
                    if (!nativeQuery)
                        return fail('INVALID_READ_CURSOR', 'native search_events cursor 缺少原始查询范围：请重新发起一次搜索。');
                    const currentHash = nativeEventSearchSnapshotHash(nativeQuery, ws.getFiles().filter(isActiveSemanticSource));
                    if (payload.sourceHash !== currentHash) {
                        return fail('STALE_READ_CURSOR', 'EMEVD native 搜索来源已变化，请重新执行 search_events。');
                    }
                    if (!context.session)
                        return fail('WORKSPACE_REQUIRED', 'native search_events 续页需要工作区会话。');
                    const edit = requireEditSession(context, 'read');
                    if (!('session' in edit))
                        return edit;
                    const nativeSearch = await emevdEdit.searchEmevdInstructionMatches({
                        edit: edit.session,
                        files: ws.getFiles().filter(isActiveSemanticSource),
                        query: nativeQuery,
                        offset: payload.offset,
                        limit,
                        ...(context.signal ? { signal: context.signal } : {})
                    });
                    if (!nativeSearch.ok)
                        return fail(nativeSearch.error.code, nativeSearch.error.message, nativeSearch.diagnostics);
                    const nextCursor = nativeSearch.truncated
                        ? createOpaqueCursor({
                            sessionId: payload.sessionId,
                            offset: nativeSearch.offset + nativeSearch.returned,
                            sourceHash: currentHash,
                            domain: 'emevd',
                            scope: payload.scope
                        })
                        : undefined;
                    return ok({
                        authority: 'native-read-event-search',
                        coverage: { scope: 'active-workspace-native-scan', status: nativeSearch.complete ? 'complete' : 'partial', negativeConclusionAllowed: nativeSearch.complete },
                        query: nativeQuery,
                        complete: nativeSearch.complete,
                        truncated: nativeSearch.truncated,
                        offset: nativeSearch.offset,
                        limit: nativeSearch.limit,
                        returned: nativeSearch.returned,
                        matches: nativeSearch.matches,
                        scannedFiles: nativeSearch.scannedFiles,
                        scannedEvents: nativeSearch.scannedEvents,
                        diagnostics: nativeSearch.diagnostics,
                        nextActions: !nativeSearch.complete && !nextCursor
                            ? [{ tool: 'search_events', args: { query: nativeQuery, limit }, reason: '原生来源扫描未完整完成；处理 diagnostics 后重试，不能作无匹配结论。' }] : [],
                        ...(nextCursor ? { nextCursor } : {})
                    });
                }
                let query;
                try {
                    const scope = JSON.parse(payload.scope.slice('search-events:'.length));
                    if (!scope || scope.workspaceId !== cursorIdentity(ws.workspaceId))
                        return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events cursor 不属于当前工作区，请重新执行 search_events。');
                    query = typeof scope.query === 'string' ? scope.query : '';
                }
                catch {
                    return fail('INVALID_READ_CURSOR', 'search_events cursor 的查询范围无法解析：请重新发起一次搜索。');
                }
                if (!query)
                    return fail('INVALID_READ_CURSOR', 'search_events cursor 缺少原始查询范围：请重新发起一次搜索。');
                // The session table is process-global; a forged or replayed sessionId
                // must not read another workspace's or another query's session items.
                const existing = defaultReadSessionManager.getSession(payload.sessionId);
                if (existing && (existing.workspaceId !== ws.workspaceId || existing.domain !== 'emevd' || existing.queryScope !== payload.scope))
                    return fail('EVENT_SEARCH_CURSOR_SCOPE_MISMATCH', 'search_events cursor 不属于当前读取会话，请重新执行 search_events。');
                const all = ws.searchEventsPage(query, 0, Number.MAX_SAFE_INTEGER);
                const sourceHash = eventSearchSnapshotHash(query, all.items);
                try {
                    const page = defaultReadSessionManager.resolvePage(cursor, sourceHash, limit);
                    return ok({
                        query,
                        ...indexedEventSearchCoverage(context, query),
                        matches: page.items,
                        total: page.total,
                        totalCount: page.total,
                        offset: page.offset,
                        limit,
                        returned: page.items.length,
                        returnedCount: page.items.length,
                        truncated: page.hasMore,
                        hasMore: page.hasMore,
                        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
                    });
                }
                catch (error) {
                    if (typeof error.code === 'string'
                        && error.code === 'STALE_READ_CURSOR') {
                        try {
                            const page = resolveStatelessCursorPage(payload, sourceHash, all.items, limit, 'emevd', payload.scope);
                            return ok({
                                query,
                                ...indexedEventSearchCoverage(context, query),
                                matches: page.items,
                                total: page.total,
                                totalCount: page.total,
                                offset: page.offset,
                                limit,
                                returned: page.items.length,
                                returnedCount: page.items.length,
                                truncated: page.hasMore,
                                hasMore: page.hasMore,
                                ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
                            });
                        }
                        catch (fallbackError) {
                            error = fallbackError;
                        }
                    }
                    const code = typeof error.code === 'string'
                        ? error.code
                        : 'INVALID_READ_CURSOR';
                    return fail(code, error instanceof Error ? error.message : 'search_events cursor 无法续页。');
                }
            }
            if (file !== undefined || eventId !== undefined) {
                if (!file || eventId === undefined || !Number.isSafeInteger(eventId)) {
                    return fail('INVALID_INPUT', 'search_events exact lookup 需要 file 与安全整数 eventId。');
                }
                const resolvedFile = resolveIndexedResourceFile(context, file, 'event');
                if (!resolvedFile.ok)
                    return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
                const matches = ws.lookupEvents(eventId, resolvedFile.sourceUri).slice(0, limit);
                if (matches.length === 0) {
                    return fail('EVENT_NOT_FOUND', `未找到 ${file} 中的 eventId ${eventId}。`);
                }
                return ok(matches);
            }
            const query = asOptionalString(value.query)?.trim();
            if (!query)
                return fail('INVALID_INPUT', 'search_events 需要 query，或 file + eventId。');
            const indexedPage = ws.searchEventsPage(query, 0, Number.MAX_SAFE_INTEGER);
            if (indexedPage.items.length > 0) {
                const sourceHash = eventSearchSnapshotHash(query, indexedPage.items);
                const scope = `search-events:${JSON.stringify({ query, workspaceId: cursorIdentity(ws.workspaceId) })}`;
                const session = defaultReadSessionManager.createSession({
                    workspaceId: ws.workspaceId,
                    sourceVersion: { sourceUri: `search://events/${encodeURIComponent(query)}`, sourceHash },
                    domain: 'emevd',
                    queryScope: scope,
                    items: indexedPage.items
                });
                const firstCursor = createOpaqueCursor({ sessionId: session.sessionId, offset: 0, sourceHash, domain: 'emevd', scope });
                const page = defaultReadSessionManager.resolvePage(firstCursor, sourceHash, limit);
                return ok({
                    query,
                    ...indexedEventSearchCoverage(context, query),
                    matches: page.items,
                    total: page.total,
                    totalCount: page.total,
                    offset: page.offset,
                    limit,
                    returned: page.items.length,
                    returnedCount: page.items.length,
                    truncated: page.hasMore,
                    hasMore: page.hasMore,
                    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {})
                });
            }
            // The index is a bounded semantic projection and may legitimately lack
            // instruction rows after a fresh mount. For a precise instruction name
            // or numeric ID, cross-file native reading is the authority fallback;
            // Chinese behavior phrases continue through reference/RAG discovery.
            if (emevdEdit.isPreciseEmevdInstructionQuery(query) && context.session) {
                const edit = requireEditSession(context, 'read');
                if ('session' in edit) {
                    const nativeSearch = await emevdEdit.searchEmevdInstructionMatches({
                        edit: edit.session,
                        files: ws.getFiles().filter(isActiveSemanticSource),
                        query,
                        limit,
                        ...(context.signal ? { signal: context.signal } : {})
                    });
                    if (!nativeSearch.ok) {
                        return fail(nativeSearch.error.code, nativeSearch.error.message, nativeSearch.diagnostics);
                    }
                    {
                        const sourceHash = nativeEventSearchSnapshotHash(query, ws.getFiles().filter(isActiveSemanticSource));
                        const scope = `native-events:${JSON.stringify({ query, workspaceId: cursorIdentity(ws.workspaceId) })}`;
                        const nextCursor = nativeSearch.truncated
                            ? createOpaqueCursor({
                                sessionId: randomUUID(),
                                offset: nativeSearch.offset + nativeSearch.returned,
                                sourceHash,
                                domain: 'emevd',
                                scope
                            })
                            : undefined;
                        return ok({
                            authority: 'native-read-event-search',
                            coverage: { scope: 'active-workspace-native-scan', status: nativeSearch.complete ? 'complete' : 'partial', negativeConclusionAllowed: nativeSearch.complete },
                            query,
                            complete: nativeSearch.complete,
                            truncated: nativeSearch.truncated,
                            offset: nativeSearch.offset,
                            limit: nativeSearch.limit,
                            returned: nativeSearch.returned,
                            scannedFiles: nativeSearch.scannedFiles,
                            scannedEvents: nativeSearch.scannedEvents,
                            matches: nativeSearch.matches,
                            diagnostics: nativeSearch.diagnostics,
                            nextActions: !nativeSearch.complete && !nextCursor
                                ? [{ tool: 'search_events', args: { query, limit }, reason: '原生来源扫描未完整完成；处理 diagnostics 后重试，不能作无匹配结论。' }] : [],
                            ...(nextCursor ? { nextCursor } : {})
                        });
                    }
                }
            }
            // A zero-hit answer that says nothing is indistinguishable from "the search never ran": an
            // unanalyzed workspace has no semantic corpus, so the fallback came back empty with no note.
            // A zero-hit answer used to drop matches/query/pagination and answer with a bare {items}.
            // Keep the page contract so a caller reads one shape on hit, miss and unavailable corpus.
            const zeroHitPage = {
                query,
                matches: [],
                matchesReturnedCount: 0,
                matchesTotalCount: 0,
                total: 0,
                totalCount: 0,
                offset: 0,
                limit,
                returned: 0,
                returnedCount: 0,
                truncated: false,
                complete: true
            };
            const fallback = await ragSearchFallback(context, query, ['event'], limit, 'search_events');
            const fallbackItems = fallback.ok && fallback.data && typeof fallback.data === 'object'
                ? fallback.data.items
                    ?? fallback.data.matches
                : undefined;
            if (fallback.ok && (fallbackItems === undefined || fallbackItems.length === 0)) {
                return ok({
                    ...zeroHitPage,
                    ...(fallback.data && typeof fallback.data === 'object' ? { fallback: fallback.data } : {}),
                    note: '本次没有命中：语义语料为空时只会查询索引投影。'
                        + '要确定某个事件是否存在，用 file + eventId 精确读取，或 file + 指令名做该文件的原生扫描。',
                    nextActions: [{ tool: 'search_events', reason: '带上 file（可再加 file + eventId 或指令名）对该文件做原生搜索。' }]
                });
            }
            // An unavailable corpus is not a clean miss: return the failure as it is instead of a page
            // whose only difference from "nothing matched" is a sentence of note text. An ok fallback
            // that did carry items is handed back whole, exactly as before.
            return fallback;
        }
    };
}
//# sourceMappingURL=search_events.js.map