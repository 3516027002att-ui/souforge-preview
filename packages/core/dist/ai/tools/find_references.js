import { fail, ok, requireEditSession } from '../toolRegistrySupport.js';
import { decodeReferenceQueryInput } from '@soulforge/shared';
import { loadFirstPartyEmedfRegistry } from '../../schema/sekiro/firstPartySchema.js';
import { createReferenceQueryService } from '../../references/referenceQueryService.js';
import { resolveEntity } from '.././entityResolution.js';
import { defaultReferenceCursorStore } from '../../references/referenceCursorStore.js';
import { prepareReferenceContentSearch } from '../../references/referenceContentSearch.js';
import { isParamRowSourceFile } from '../../references/nativeReferenceContent.js';
import { loadWorkspaceEventInstructionIndex } from '../eventArgumentIndexService.js';
import { assessParameterizedEntityCoverage } from '../../references/parameterizedEntityCoverage.js';
import { buildQueryScopedNegativeConclusion } from '../../references/queryScopedNegativeConclusion.js';
import { applyReferenceQueryConclusion } from '../../references/referencePageProjection.js';
/** find_references: one domain tool declaration, schema and handler. */
const referenceBundleMemo = new Map();
const REFERENCE_BUNDLE_MEMO_LIMIT = 4;
/** toSymbolBundle() builds a fresh wrapper each call; reuse it per revision so the service can memo. */
function stableReferenceBundle(context, ws) {
    // Each call may receive a refreshed clone, so object identity is not a usable cache key; the
    // session id plus the indexed-files revision is. Same key means the same corpus content.
    const key = `${context.workspaceSessionId ?? 'session'}#${context.indexedFilesRevision ?? 'rev'}`;
    const hit = referenceBundleMemo.get(key);
    if (hit !== undefined) {
        if (process.env.SOULFORGE_DEBUG_REF === '1')
            console.error('[ref:timing] bundle-cache=hit');
        return hit.bundle;
    }
    const bundle = ws.toSymbolBundle();
    referenceBundleMemo.set(key, { bundle });
    while (referenceBundleMemo.size > REFERENCE_BUNDLE_MEMO_LIMIT) {
        const oldest = referenceBundleMemo.keys().next().value;
        if (oldest === undefined)
            break;
        referenceBundleMemo.delete(oldest);
    }
    if (process.env.SOULFORGE_DEBUG_REF === '1')
        console.error('[ref:timing] bundle-cache=miss');
    return bundle;
}
/** SOULFORGE_DEBUG_REF=1 prints per-phase timings; a 10 s answer needs to say where the seconds went. */
function referencePhaseLogger() {
    if (process.env.SOULFORGE_DEBUG_REF !== '1')
        return () => { };
    const startedAt = Date.now();
    let last = startedAt;
    return (label) => {
        const now = Date.now();
        console.error(`[ref:tool] ${label}=${now - last}ms (total ${now - startedAt}ms)`);
        last = now;
    };
}
function mapIdFromReferenceIdentity(uri) {
    if (!uri)
        return undefined;
    return /(m\d+_\d+_\d+_\d+)/u.exec(uri)?.[1];
}
/**
 * 行地址本身就用原生表名（`param://SP_EFFECT_PARAM_ST/9061`），而索引里的表名
 * 是目录名（`SpEffectParam`）。按行 uri 找到来源，才能把参数表容器排到扫描最前，
 * 不让事件/脚本的读取预算把它挤出本次查询。
 */
function paramRowSourceUri(ws, rawUri) {
    const uri = rawUri.trim();
    if (!/^param:\/\//iu.test(uri))
        return undefined;
    for (const item of ws.toSymbolBundle().params ?? []) {
        if (!item.rows.some((row) => row.uri === uri))
            continue;
        return item.sourceUri ?? item.rows[0]?.sourceUri;
    }
    return undefined;
}
/**
 * PARAM→PARAM 同域通道的查询级覆盖度。
 *
 * 分母只算参数表容器（`isParamRowSourceFile`）：`param/drawparam/*.gparam.dcx`
 * 不是参数表，native 引用扫描也不会读它们，算进分母会让同域否定结论永远停在
 * inconclusive。分子只认**真正读到字段投影的来源**：PARAM→PARAM 边来自行字段上的
 * 受信任 metadata Refs，只有行清单、没有字段的 catalog 投影一条边也产生不了。
 *
 * 本次查询跑了扫描时用扫描自己的完成数（权威）；续页查询（cursor）不重扫，
 * 退回索引里已有的字段投影，避免同一结果集在翻页时把 verdict 从否定翻成
 * inconclusive。两者都取不到证据时保持 inconclusive。
 */
function paramRowChannelCoverage(ws, snapshot, channel) {
    const staleIds = new Set(snapshot.find((entry) => entry.domain === 'param')?.staleSources ?? []);
    const sources = ws.getFiles().filter((file) => isParamRowSourceFile(file)).map((file) => file.sourceUri);
    const hydrated = new Set();
    for (const item of ws.toSymbolBundle().params ?? []) {
        const sourceUri = item.sourceUri ?? item.rows[0]?.sourceUri;
        if (sourceUri === undefined)
            continue;
        if (item.rows.some((row) => (row.fields?.length ?? 0) > 0))
            hydrated.add(sourceUri);
    }
    const fromIndex = sources.filter((sourceUri) => hydrated.has(sourceUri) && !staleIds.has(sourceUri)).length;
    return {
        domain: 'param',
        // 本次查询有扫描证书时以它为准；续页没有扫描，退回索引里的字段投影。
        covered: channel !== undefined ? channel.completed : fromIndex,
        expected: channel?.total ?? sources.length,
        stale: sources.filter((sourceUri) => staleIds.has(sourceUri)).length
    };
}
/**
 * `negativeConclusionAllowed` 只能来自本次查询自己的覆盖范围：
 * - map part：同图事件文件里的参数化 entityId/targetEntityId 会让“没有引用”变成“看不见”；
 * - event：事件调用实参 eventId 的参数化才相关；
 * - fmg：文本实参（messageId/nameId 等）的参数化才相关；
 * - param：PARAM→PARAM 是同域通道（受信任 metadata Refs），没有公共事件形参，
 *   覆盖度只看本次扫描读完了多少参数表容器；
 * - 其它域（script/tae）的引用通道还没有参数化索引，必须保持不可否定。
 * 整体结构完整性（coverage.status）不参与这个判断。
 */
async function concludeReferenceQuery(input) {
    const target = input.page.target;
    const targetUri = target?.sourceUri ?? '';
    const isRegion = /\/region\//u.test(targetUri) || /\/region\//u.test(target?.label ?? '');
    let domains = [];
    let role;
    let mapId;
    let scopeLabel = '本次查询范围';
    let unavailableReason;
    /** 同域通道没有公共事件形参索引；不能因此判“通道不可用”。 */
    let requiresParameterizedAssessment = true;
    if (target === undefined) {
        unavailableReason = '没有可解析的根目标，无法确定本次查询的引用通道';
    }
    else if (target.domain === 'map' && isRegion) {
        unavailableReason = '地图 region 的引用通道（regionId）尚未进入参数化实参索引';
    }
    else if (target.domain === 'map') {
        domains = ['event'];
        role = 'entity';
        mapId = mapIdFromReferenceIdentity(targetUri) ?? mapIdFromReferenceIdentity(target.label);
        if (mapId === undefined) {
            unavailableReason = '无法从目标身份确定地图 id，不能限定本次查询的事件文件范围';
        }
        else {
            scopeLabel = `${mapId} 的事件文件`;
        }
    }
    else if (target.domain === 'emevd') {
        domains = ['event'];
        role = 'event';
        scopeLabel = '工作区事件索引';
    }
    else if (target.domain === 'fmg') {
        domains = ['event', 'param', 'msg'];
        role = 'text';
        scopeLabel = '工作区事件索引';
    }
    else if (target.domain === 'param') {
        // PARAM→PARAM 是同域通道：引用来自受信任 metadata 的 Refs 规则，不是公共
        // 事件形参。旧兜底分支把 param 当“尚未进入参数化实参索引”，于是有边也
        // 返回 QUERY_SCOPE_UNAVAILABLE + inconclusive。
        domains = ['param'];
        scopeLabel = '工作区 PARAM 表';
        requiresParameterizedAssessment = false;
    }
    else {
        unavailableReason = `${target.domain} 的引用通道（paramId/脚本调用等）尚未进入参数化实参索引`;
    }
    const snapshot = input.ws.getCoverageSnapshot();
    const coverage = domains.map((domain) => {
        if (domain === 'param')
            return paramRowChannelCoverage(input.ws, snapshot, input.paramChannel);
        const state = snapshot.find((item) => item.domain === domain);
        return {
            domain,
            covered: state?.coveredResourceIds?.length ?? state?.coveredResources ?? 0,
            expected: state?.expectedResourceIds?.length ?? state?.expectedResources ?? 0,
            stale: state?.staleSources.length ?? 0
        };
    });
    const complete = domains.length > 0 && coverage.every((entry) => entry.stale === 0 && entry.expected > 0 && entry.covered >= entry.expected);
    let assessment;
    if (role !== undefined && unavailableReason === undefined) {
        if (input.editSession === undefined) {
            unavailableReason = '本次查询无法打开原生读取会话，事件参数索引不可用';
        }
        else {
            const loaded = await input.loadIndex({
                workspaceId: input.workspaceId,
                ws: input.ws,
                edit: input.editSession,
                ...(input.signal ? { signal: input.signal } : {})
            });
            if (!loaded.ok) {
                unavailableReason = loaded.message;
            }
            else {
                assessment = assessParameterizedEntityCoverage({
                    files: loaded.index.files,
                    role,
                    ...(mapId === undefined ? {} : { mapId })
                });
            }
        }
    }
    const conclusion = buildQueryScopedNegativeConclusion({
        domains,
        coverage,
        ...(assessment ? { assessment } : {}),
        ...(requiresParameterizedAssessment ? {} : { requiresParameterizedAssessment: false }),
        ...(unavailableReason === undefined ? {} : { unavailableReason }),
        scopeLabel
    });
    const parameterized = assessment === undefined ? undefined : {
        role: assessment.role,
        scope: assessment.scope,
        relevant: assessment.relevantCount,
        total: assessment.totalCount,
        instructions: assessment.relevantInstructions,
        ...(assessment.unrelatedInstructions.length === 0 ? {} : { unrelatedInstructions: assessment.unrelatedInstructions }),
        otherRoleCount: assessment.otherRoleCount,
        filesInScope: assessment.filesInScope,
        filesUnread: assessment.filesUnread
    };
    return applyReferenceQueryConclusion(input.page, {
        verdict: conclusion.verdict,
        negativeConclusionAllowed: conclusion.negativeConclusionAllowed,
        blockedReasons: conclusion.blockedReasons,
        caveats: conclusion.caveats,
        domains,
        complete,
        sources: conclusion.sources,
        ...(parameterized ? { parameterized } : {})
    });
}
export function createFindReferencesTool() {
    return {
        name: 'find_references',
        description: 'Find related content and actual usages: parameter fields, text, event instructions, and script calls, '
            + 'with file/table/event/function locations, snippets, relationship reasons, and continuation actions. Provide exactly one of '
            + 'uri (logical symbol uri), target (precise native selector, e.g. '
            + '{domain:"param",sourceUri,entryIndex,rowId} / {domain:"emevd",sourceUri,eventId} / {domain:"tae",sourceUri,childChain,taeEntryIndex,animId} / {domain:"fmg",sourceUri,childChain,category,textId} / {domain:"map",sourceUri,nativeObjectKey}) or '
            + 'query (delegated to resolveEntity). A map nativeObjectKey accepts internalEntryId, the entity name, '
            + '<mapId>#<name>, the offset-qualified address <mapId>#<name>@0x<offset>, the '
            + 'map://<mapId>/part/<name> handle search_map_entities returns (duplicated names carry @0x<offset>), '
            + 'or the numeric entityId. '
            + 'MSB allows duplicate part names; the index keeps the native file offset, so @0x<offset> selects exactly '
            + 'one entity, while a bare duplicated name answers resolution=ambiguous with one candidate per entity, '
            + 'each carrying discriminators.address, discriminators.uri and discriminators.nativeOffset. '
            + 'Pick the @0x address instead of the shared name. '
            + 'Optional: direction (from|to|both), detail '
            + '(edges|context), fieldIds (param root only), depth (1-4), limit (1-32), '
            + 'includeHypotheses, cursor (next result page) or sourceCursor (continue scanning unread sources with the original query). '
            + 'Cost warning: detail=context (the default) runs a content enrichment scan over sources and measured '
            + '9.4 s per call on a 50k-row PARAM corpus; detail=edges returns the graph alone in milliseconds after '
            + 'the first call. A PARAM row root still reads its param container once on the first call '
            + '(same-domain queries scan only their own domain), because row-level Refs come from the row '
            + 'fields and the catalog does not carry them: without that read the graph has no '
            + 'PARAM→PARAM edges at all (the same query under detail=context is not allowed to differ). '
            + 'Ask for edges when the question is "what references this", and context only when '
            + 'you need snippets or locations.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: {
            uri: 'string?',
            target: 'object?',
            query: 'string?',
            domain: 'string?',
            direction: 'enum:from|to|both?',
            detail: 'enum:edges|context?',
            fieldIds: 'array?',
            depth: 'number?',
            limit: 'number?',
            includeHypotheses: 'boolean?',
            cursor: 'string?',
            sourceCursor: 'string?'
        },
        run: async (input, context) => {
            const mark = referencePhaseLogger();
            mark('start');
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const decoded = decodeReferenceQueryInput(input);
            if (!decoded.ok)
                return fail(decoded.code, decoded.message);
            const emedf = loadFirstPartyEmedfRegistry();
            const resolveQuery = async (query, domain) => {
                const resolved = await resolveEntity({
                    index: ws,
                    query,
                    ...(domain ? { domain: domain === 'fmg' ? 'msg' : domain === 'emevd' ? 'event' : domain } : {}),
                    maxCandidates: 8
                });
                if (resolved.status === 'ambiguous' || resolved.candidates.length > 1) {
                    return {
                        resolution: 'ambiguous',
                        candidates: resolved.candidates.slice(0, 8).map((candidate) => ({
                            uri: candidate.candidateId,
                            label: candidate.label ?? candidate.nativeHandle,
                            discriminators: { nativeHandle: candidate.nativeHandle, route: candidate.route }
                        }))
                    };
                }
                if (resolved.status === 'resolved' && resolved.candidates.length === 1) {
                    const candidate = resolved.candidates[0];
                    return { resolution: 'resolved', uri: candidate.candidateId };
                }
                return {
                    resolution: resolved.status === 'not_found' || resolved.status === 'not_found_complete_coverage'
                        ? 'not_found' : 'insufficient_evidence'
                };
            };
            try {
                // search_param_rows hands back a param://<table>/<rowId> uri, which the reference service
                // cannot resolve; the target selector it does understand carries sourceUri/entryIndex/rowId.
                // Translate the uri through the index so a search hit can be fed straight back in.
                const effectiveInput = input;
                // read_tae_events returns action://<chr>/tae/<entry>/<code>[/e<index>] addresses; the reference
                // service needs a tae target (sourceUri + childChain + taeEntryIndex + animId). Resolve the address
                // through the index so an action read can be fed straight back in.
                const rawUri = typeof effectiveInput.uri === 'string' ? effectiveInput.uri.trim() : '';
                const actionMatch = /^action:\/\/([^/]+)\/tae\/(\d+)\/([A-Za-z]+\d+)(?:\/e(\d+))?$/u.exec(rawUri);
                if (actionMatch !== null && effectiveInput.target === undefined) {
                    const [, chrId, entryIndexText, code, eventIndexText] = actionMatch;
                    const taeExports = (ws?.toSymbolBundle().tae ?? []);
                    for (const tae of taeExports) {
                        const animation = (tae.animations ?? []).find((candidate) => String(candidate.code) === code
                            && String(candidate.taeEntryIndex) === String(Number(entryIndexText))
                            && (tae.chrId === undefined || String(tae.chrId) === chrId));
                        if (animation === undefined || typeof tae.sourceUri !== 'string' || typeof animation.animId !== 'number')
                            continue;
                        const child = animation.taeEntryName ?? animation.taeGroup;
                        input = {
                            ...input,
                            uri: undefined,
                            target: {
                                domain: 'tae',
                                sourceUri: tae.sourceUri,
                                childChain: typeof child === 'string' && child !== '' ? [child] : [],
                                ...(typeof animation.taeEntryIndex === 'number' ? { taeEntryIndex: animation.taeEntryIndex } : {}),
                                animId: animation.animId,
                                ...(eventIndexText === undefined ? {} : { eventIndex: Number(eventIndexText) })
                            }
                        };
                        break;
                    }
                }
                if (/^param:\/\/[^/]+\/\d+$/i.test(rawUri) && effectiveInput.target === undefined) {
                    const params = (ws?.toSymbolBundle().params ?? []);
                    for (const table of params) {
                        const [, uriTable, uriRowId] = /^param:\/\/([^/]+)\/(\d+)$/i.exec(rawUri) ?? [];
                        const wantedTable = String(uriTable ?? '').replaceAll('_', '').toLowerCase();
                        const wantedRowId = Number(uriRowId);
                        const tableMatches = typeof table.paramName === 'string'
                            && String(table.paramName).replaceAll('_', '').toLowerCase() === wantedTable;
                        if (!tableMatches)
                            continue;
                        const row = (table.rows ?? []).find((candidate) => candidate.rowId === wantedRowId);
                        if (row === undefined)
                            continue;
                        if (typeof row.sourceUri === 'string' && Number.isSafeInteger(row.rowId)) {
                            input = {
                                ...input,
                                uri: undefined,
                                target: {
                                    domain: 'param',
                                    sourceUri: row.sourceUri,
                                    rowId: row.rowId,
                                    ...(typeof row.entryIndex === 'number' ? { entryIndex: row.entryIndex } : {})
                                }
                            };
                        }
                        break;
                    }
                }
                if (process.env.SOULFORGE_DEBUG_REF === '1')
                    console.error('[ref:param-uri]', rawUri, 'target', JSON.stringify(input.target ?? null));
                const normalized = decoded.input;
                const resolved = normalized.query ? await resolveQuery(normalized.query, normalized.domain) : undefined;
                const cursorStore = context.referenceCursorStore ?? defaultReferenceCursorStore;
                let preparation;
                // detail:"edges" asks for the reference graph only. The content scan costs 20 s and up
                // (maxSources 2 / 512 KB per call), so skip it unless the caller wants context or is
                // continuing a source scan.
                // A param:// row uri the index does not hold cannot resolve, yet the content scan still
                // ran for it: 9.4 s measured, ending in insufficient_evidence. Skip the scan when the root
                // provably cannot resolve and let the service return the same verdict quickly.
                const rootUnresolvable = (() => {
                    const uri = normalized.uri;
                    if (typeof uri !== 'string' || !uri.startsWith('param://'))
                        return false;
                    const [table, rowIdText] = uri.slice('param://'.length).split('/');
                    const rowId = Number(rowIdText);
                    if (table === undefined || !Number.isSafeInteger(rowId))
                        return false;
                    const normalize = (value) => String(value ?? '').replaceAll('_', '').toLowerCase();
                    // 原生表名（SP_EFFECT_PARAM_ST）与目录名（SpEffectParam）不同，行地址又
                    // 用原生名拼：只比 paramName 会把索引明明持有的行判成“不可解析”，
                    // 于是同一行有边却被跳过补全。与 referenceQueryService 的别名规则一致。
                    const aliasKey = (value) => normalize(value).replace(/\.param$/u, '').replace(/st$/u, '');
                    const params = ws.toSymbolBundle().params ?? [];
                    const tableExport = params.find((item) => normalize(item.paramName) === normalize(table)
                        || normalize(item.entryName) === normalize(table)
                        || aliasKey(item.paramName) === aliasKey(table)
                        || aliasKey(item.entryName) === aliasKey(table)
                        || item.rows.some((row) => row.uri === uri.trim()));
                    if (tableExport === undefined)
                        return true;
                    return !tableExport.rows.some((row) => row.rowId === rowId);
                })();
                // `input` may have been rewritten from a param:// uri into a precise target above; the
                // translated selector is the one the service resolves, so the scan's domain decision must
                // read it too. `query` roots only reveal their domain through the resolved uri.
                const translatedTarget = input.target;
                const resolvedParamRoot = typeof resolved?.uri === 'string'
                    && (/^param:\/\//iu.test(resolved.uri) || /\.parambnd\.dcx/iu.test(resolved.uri));
                const sameDomainParamRoot = translatedTarget?.domain === 'param'
                    || normalized.domain === 'param'
                    || resolvedParamRoot
                    || (rawUri !== '' && /^param:\/\//iu.test(rawUri));
                // A PARAM→PARAM edge comes from the trusted-metadata Refs on the source row's FIELDS, and
                // those fields only exist after the native reference read. Skipping the scan for
                // detail:"edges" therefore answered the same question with an empty graph while
                // detail:"context" returned confirmed edges. Same-domain channels always run the same
                // enrichment, and finish their own domain in one call instead of paging over gparams.
                const wantsContentScan = (normalized.detail !== 'edges' || normalized.sourceCursor !== undefined || sameDomainParamRoot)
                    && !rootUnresolvable;
                mark(wantsContentScan ? 'content-scan-start' : 'content-scan-skipped');
                if (wantsContentScan && !normalized.cursor && context.session && (!resolved || resolved.resolution === 'resolved')) {
                    const edit = requireEditSession(context, 'read');
                    if (!('session' in edit))
                        return edit;
                    const targetSource = (typeof translatedTarget?.sourceUri === 'string' ? translatedTarget.sourceUri : undefined)
                        ?? (normalized.target && 'sourceUri' in normalized.target ? normalized.target.sourceUri : undefined)
                        ?? (rawUri === '' ? undefined : paramRowSourceUri(ws, rawUri))
                        ?? (resolved?.uri === undefined ? undefined : paramRowSourceUri(ws, resolved.uri));
                    const targetUri = resolved?.uri ?? normalized.uri;
                    const contentStartedAt = Date.now();
                    context.onDiagnostic?.({
                        phase: 'reference.content-scan',
                        status: 'start',
                        details: { sourceCursor: normalized.sourceCursor ?? null }
                    });
                    try {
                        preparation = await prepareReferenceContentSearch({
                            index: ws, edit: edit.session, input: normalized, store: cursorStore,
                            ...(emedf.ok ? { registry: emedf.registry } : {}),
                            ...(context.signal ? { signal: context.signal } : {}),
                            ...(targetUri ? { targetUri } : {}),
                            ...(targetSource ? { prioritySourceUris: [targetSource] } : {}),
                            ...(sameDomainParamRoot ? { maxSourcesByDomain: { param: Number.MAX_SAFE_INTEGER } } : {}),
                            ...(sameDomainParamRoot ? { domains: ['param'] } : {}),
                            ...(context.onSemanticEvidenceUpdated ? { persist: context.onSemanticEvidenceUpdated } : {}),
                            ...(context.onDiagnostic ? { onDiagnostic: context.onDiagnostic } : {})
                        });
                        context.onDiagnostic?.({
                            phase: 'reference.content-scan',
                            status: 'complete',
                            elapsedMs: Date.now() - contentStartedAt,
                            details: { scan: preparation.scan }
                        });
                    }
                    catch (error) {
                        context.onDiagnostic?.({
                            phase: 'reference.content-scan',
                            status: 'failed',
                            elapsedMs: Date.now() - contentStartedAt,
                            details: { message: error instanceof Error ? error.message : String(error) }
                        });
                        throw error;
                    }
                }
                // The index caches one graph per option set; rebuilding it on every call dominated the
                // response time (47 s cold / 11 s warm before this).
                const prebuilt = ws.rebuildReferences({
                    ...(emedf.ok ? { registry: emedf.registry } : {})
                });
                mark('content-scan-done');
                mark('rebuildReferences');
                const service = createReferenceQueryService({
                    bundle: stableReferenceBundle(context, ws), workspaceId: ws.workspaceId,
                    coverageStates: ws.getCoverageSnapshot(),
                    providerRegistryDigest: 'soulforge-reference-providers-content-v3',
                    ...(emedf.ok ? { registry: emedf.registry } : {}),
                    prebuiltEdges: prebuilt.edges,
                    cursorStore,
                    ...(preparation?.scan ? { scan: preparation.scan } : {}),
                    ...(preparation ? { sourceDiagnostics: preparation.diagnostics } : {}),
                    resolveQuery: async (query, domain) => resolved ?? resolveQuery(query, domain)
                });
                const relationStartedAt = Date.now();
                context.onDiagnostic?.({
                    phase: 'reference.relation-page',
                    status: 'start',
                    details: { cursor: normalized.cursor ?? null, limit: normalized.limit }
                });
                let page;
                try {
                    page = await service.query(input);
                    mark('service.query');
                    mark('page-ready');
                    context.onDiagnostic?.({
                        phase: 'reference.relation-page',
                        status: 'complete',
                        elapsedMs: Date.now() - relationStartedAt,
                        details: {
                            resolution: page.resolution,
                            returnedCount: page.page.returnedCount,
                            hasMore: page.page.hasMore,
                            scan: page.scan
                        }
                    });
                }
                catch (error) {
                    context.onDiagnostic?.({
                        phase: 'reference.relation-page',
                        status: 'failed',
                        elapsedMs: Date.now() - relationStartedAt,
                        details: { message: error instanceof Error ? error.message : String(error) }
                    });
                    throw error;
                }
                mark('response-built');
                // 关联图只认字面量实参；否定结论必须由本次查询自己的范围决定。
                const readSession = requireEditSession(context, 'read');
                const concluded = await concludeReferenceQuery({
                    page,
                    workspaceId: ws.workspaceId,
                    ws,
                    ...('session' in readSession ? { editSession: readSession.session } : {}),
                    loadIndex: loadWorkspaceEventInstructionIndex,
                    ...(preparation?.channel ? { paramChannel: preparation.channel.param } : {}),
                    ...(context.signal ? { signal: context.signal } : {})
                });
                mark('negative-conclusion');
                return ok(concluded);
            }
            catch (error) {
                const code = typeof error.code === 'string'
                    ? error.code : 'REFERENCE_QUERY_FAILED';
                return fail(code, error.message ?? '关联查询失败。');
            }
        }
    };
}
//# sourceMappingURL=find_references.js.map