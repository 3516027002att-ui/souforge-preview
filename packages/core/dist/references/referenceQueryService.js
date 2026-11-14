/**
 * ReferenceQueryService（T08，执行指令 §T08）。
 *
 * 固定执行顺序：
 * 1. 解码输入（共享 strict decoder）；游标续页先做宿主登记校验。
 * 2. 精确 target 走 bundle 内的精确身份解析；uri 逻辑寻址不能唯一解析时返回
 *    候选；query 委托现有 resolveEntity（宿主注入），不另起第二套名称搜索。
 * 3. 歧义在本步结束：只返回候选 + 覆盖 + 选定后的调用入口，不深读候选。
 * 4. 根目标锁定当前版本；fieldIds 读取原生值形成 targetRead 快照。
 * 5. 通过 provider registry 取 source-scoped 分片（同 source/version 合并）。
 * 6. 按 direction/depth/node/edge/source 上限做真正多跳遍历；contains/member_of
 *    仅作为根的终止关系，避免容器边把无关子图全部展开；保留完整 path。
 * 7. 语句/位置来自 provider 证据；解析失败保留诊断。
 * 8. coverage + 依赖摘要 + envelope 预算分页；targetRead 建立字段观察登记。
 */
import { createHash } from 'node:crypto';
import { decodeReferenceQueryInput, formatMapEntityAddresses, parseMapAddress, parseMapOffsetSuffix, REFERENCE_DEPTH_DEFAULT, REFERENCE_LIMIT_DEFAULT } from '@soulforge/shared';
import { buildBoundedPage, buildCoverage, buildDependencySummary, collectSourceVersions, assembleRelations, certaintyForEdge, edgeIdentityKey, identityForUri, REFERENCE_CURSOR_TOKEN_PLACEHOLDER } from './referencePageProjection.js';
import { REFERENCE_PROVIDERS } from './referenceProviderRegistry.js';
import { buildEventCallChain } from './eventReferenceProvider.js';
import { dependencySummariesMatch } from '../runtime/resourceVersion.js';
import { defaultReferenceCursorStore } from './referenceCursorStore.js';
// No memo here on purpose. The cursor's scope fingerprint must describe the bundle as it is *now*:
// callers hand the service a bundle they keep mutating in place (the workspace index refreshes the
// same object). A cache keyed on the bundle object would return the fingerprint of its earlier
// content, so a real change would never invalidate the cursor — that is a correctness hole, not a
// missed optimization. Hashing the whole 50k-row bundle costs ~2.4 s (measured), and that cost is
// what the REFERENCE_CURSOR_SCOPE_MISMATCH check is made of; nothing cheaper can stand in for it.
// If this ever needs to be fast again, key it on a content version the host maintains, never on the
// object.
/**
 * One map object has several exact handles. `resolve_entity` treats `<mapId>#<name>` as exact, and
 * `search_map_entities` returns `map://<mapId>/part/<name>`; a find_references map target that only
 * compared native internalEntryId rejected both of the handles the other tools hand out.
 */
function decodeMapTargetKey(key) {
    const trimmed = key.trim();
    try {
        return decodeURIComponent(trimmed);
    }
    catch {
        return trimmed;
    }
}
/**
 * `@0x<offset>` 是 MSB 的唯一身份（MSB 允许同名 part），索引记录保留 nativeOffset，
 * 所以地址/uri 里的偏移必须参与匹配。返回 undefined 表示调用方没有给偏移。
 */
function wantedMapNativeOffset(wantedKey) {
    const parsed = parseMapAddress(wantedKey);
    if (parsed?.nativeOffset !== undefined)
        return parsed.nativeOffset;
    return parseMapOffsetSuffix(wantedKey)?.nativeOffset;
}
/** True when any exact handle of this map entity equals the wanted key. */
export function mapTargetKeyMatches(entity, wantedKey) {
    const keys = new Set([
        entity.uri,
        entity.name,
        `${entity.mapId}#${entity.name}`
    ]);
    if (entity.address !== undefined)
        keys.add(entity.address);
    if (entity.internalEntryId !== undefined)
        keys.add(String(entity.internalEntryId));
    if (entity.entityId !== undefined)
        keys.add(String(entity.entityId));
    if (keys.has(wantedKey))
        return true;
    // A key may carry a URI-encoded entity name while the index holds it decoded.
    if ([...keys].some((key) => decodeMapTargetKey(key) === wantedKey))
        return true;
    // `<mapId>#<name>@0x…`, `map://<mapId>/part/<name>@0x…` and `<name>@0x…` select one
    // duplicate by native offset instead of returning both candidates as ambiguous.
    const nativeOffset = wantedMapNativeOffset(wantedKey);
    if (nativeOffset === undefined)
        return false;
    if (entity.nativeOffset !== nativeOffset)
        return false;
    const parsed = parseMapAddress(wantedKey);
    if (parsed !== null && parsed.name !== undefined) {
        return parsed.name === entity.name
            && (parsed.block === entity.mapId || parsed.block.length === 0);
    }
    const suffix = parseMapOffsetSuffix(wantedKey);
    return suffix !== null && suffix.name === entity.name;
}
export function createReferenceQueryService(options) {
    let queryBundle = options.bundle;
    const workspaceId = options.workspaceId ?? 'workspace';
    const maxSources = options.maxSources ?? 64;
    const maxTraversalNodes = options.maxTraversalNodes ?? 256;
    const maxTraversalEdges = options.maxTraversalEdges ?? 512;
    const cursorStore = options.cursorStore ?? defaultReferenceCursorStore;
    const fieldProofs = [];
    let shardCache;
    function collectShards(includeHypotheses, sourceVersionKey) {
        const bundle = queryBundle;
        const versions = `${sourceVersionKey}|providers:${options.providerRegistryDigest ?? 'default'}|hypotheses:${includeHypotheses ? 'on' : 'off'}`;
        if (shardCache && shardCache.key === versions)
            return shardCache;
        const edges = [];
        const diagnostics = [];
        if (!includeHypotheses && options.buildOptions === undefined && options.prebuiltEdges !== undefined) {
            for (const edge of options.prebuiltEdges)
                edges.push(edge);
            shardCache = { key: versions, edges, diagnostics };
            return shardCache;
        }
        const buildOptions = {
            ...(options.registry ? { registry: options.registry } : {}),
            ...(options.buildOptions ?? {}),
            includeHypotheses
        };
        for (const provider of REFERENCE_PROVIDERS) {
            const shard = provider.build(bundle, buildOptions);
            for (const edge of shard.edges)
                edges.push(edge);
            for (const diagnostic of shard.diagnostics)
                diagnostics.push(diagnostic);
        }
        shardCache = { key: versions, edges, diagnostics };
        return shardCache;
    }
    function canonicalBundleSnapshot(bundle) {
        const ordered = {};
        const fingerprints = {};
        for (const [domain, values] of Object.entries(bundle)) {
            if (values === undefined)
                continue;
            if (Array.isArray(values)) {
                const exports = values.map(value => ({ value, key: valueVersionKey(value) }))
                    .sort((a, b) => a.key.localeCompare(b.key));
                ordered[domain] = exports.map(item => item.value);
                fingerprints[domain] = exports.map(item => item.key);
            }
            else {
                ordered[domain] = values;
                fingerprints[domain] = valueVersionKey(values);
            }
        }
        return { bundle: ordered, key: valueVersionKey(fingerprints) };
    }
    function valueVersionKey(value) {
        // Do not build one giant JSON/string key.  Real EMEVD and PARAM exports
        // contain millions of characters and the old `parts.join()` path could
        // throw V8 `Invalid string length` before the bounded page projection ran.
        // Hash a deterministic structural stream instead.  This keeps row/field
        // and instruction content in the invalidation identity without retaining
        // the whole bundle in another string.
        const hash = createHash('sha256');
        // A native hash.update per primitive dominated real CLI profiles. Buffer
        // the exact token stream, not the whole bundle, before crossing into crypto.
        let fragments = [];
        let bufferedChars = 0;
        const flush = () => {
            if (bufferedChars > 0)
                hash.update(fragments.join(''));
            fragments = [];
            bufferedChars = 0;
        };
        const append = (text) => {
            if (text.length >= 65536) {
                flush();
                hash.update(text);
                return;
            }
            fragments.push(text);
            bufferedChars += text.length;
            if (bufferedChars >= 65536)
                flush();
        };
        const write = (value, seen = new Set()) => {
            if (value === null) {
                append('null;');
                return;
            }
            switch (typeof value) {
                case 'undefined':
                    append('undefined;');
                    return;
                case 'string':
                    append(`string:${value.length}:`);
                    append(value);
                    append(';');
                    return;
                case 'number':
                    append(`number:${Number.isNaN(value) ? 'NaN' : String(value)};`);
                    return;
                case 'boolean':
                    append(value ? 'true;' : 'false;');
                    return;
                case 'bigint':
                    append(`bigint:${value.toString()};`);
                    return;
                case 'function':
                    append('function;');
                    return;
            }
            if (seen.has(value)) {
                append('cycle;');
                return;
            }
            seen.add(value);
            if (Array.isArray(value)) {
                append(`array:${value.length}[`);
                for (const item of value)
                    write(item, seen);
                append('];');
            }
            else {
                const record = value;
                // JSON-backed semantic caches omit absent optional properties. Their
                // reappearance as explicit undefined is not a native content change.
                const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
                append(`object:${keys.length}{`);
                for (const key of keys) {
                    append(`key:${key.length}:`);
                    append(key);
                    append('=');
                    write(record[key], seen);
                }
                append('};');
            }
            seen.delete(value);
        };
        write(value);
        flush();
        return `sha256:${hash.digest('hex')}`;
    }
    function cursorScopeFor(input) {
        return {
            ...(input.uri !== undefined ? { uri: input.uri } : {}),
            ...(input.target !== undefined ? { target: input.target } : {}),
            ...(input.query !== undefined ? { query: input.query } : {}),
            ...(input.domain !== undefined ? { domain: input.domain } : {}),
            direction: input.direction,
            detail: input.detail,
            ...(input.fieldIds !== undefined ? { fieldIds: [...input.fieldIds] } : {}),
            depth: input.depth,
            limit: input.limit,
            includeHypotheses: input.includeHypotheses
        };
    }
    function explicitCursorScopeMatches(raw, decoded, stored) {
        const rawRecord = raw;
        const fields = [
            'uri', 'target', 'query', 'domain', 'direction', 'detail', 'fieldIds', 'depth', 'limit', 'includeHypotheses'
        ];
        for (const field of fields) {
            if (!(field in rawRecord))
                continue;
            const current = cursorScopeFor(decoded)[field];
            const expected = stored[field];
            if (JSON.stringify(current) !== JSON.stringify(expected))
                return false;
        }
        return true;
    }
    function freshQueryArgs(input) {
        return {
            ...(input.uri !== undefined ? { uri: input.uri } : {}),
            ...(input.target !== undefined ? { target: input.target } : {}),
            ...(input.query !== undefined ? { query: input.query } : {}),
            ...(input.domain !== undefined ? { domain: input.domain } : {}),
            direction: input.direction,
            detail: input.detail,
            ...(input.fieldIds !== undefined ? { fieldIds: [...input.fieldIds] } : {}),
            depth: input.depth,
            limit: input.limit,
            includeHypotheses: input.includeHypotheses
        };
    }
    function identityOf(candidate, domain, extra) {
        return { workspaceId, domain, sourceUri: candidate.sourceUri, ...extra };
    }
    function resolveExactTarget(target) {
        const bundle = queryBundle;
        const candidates = [];
        if (!('domain' in target))
            return { candidates };
        if (target.domain === 'param') {
            for (const paramExport of bundle.params ?? []) {
                if (paramExport.sourceUri !== target.sourceUri)
                    continue;
                if (paramExport.entryIndex !== target.entryIndex)
                    continue;
                if (target.entryName !== undefined && paramExport.entryName !== target.entryName)
                    continue;
                for (const row of paramExport.rows) {
                    if (row.rowId !== target.rowId)
                        continue;
                    if (target.rowIndex !== undefined && row.rowIndex !== target.rowIndex)
                        continue;
                    candidates.push({
                        uri: row.uri,
                        label: `${paramExport.paramName}#${row.rowId}`,
                        discriminators: {
                            entryIndex: paramExport.entryIndex,
                            ...(row.rowIndex !== undefined ? { rowIndex: row.rowIndex } : {}),
                            ...(row.dataHash ? { dataHash: row.dataHash } : {})
                        },
                        identity: identityOf(row, 'param', {
                            ...(paramExport.entryIndex !== undefined ? { entryIndex: paramExport.entryIndex } : {}),
                            rowId: row.rowId,
                            ...(row.rowIndex !== undefined ? { rowIndex: row.rowIndex } : {})
                        })
                    });
                }
            }
        }
        else if (target.domain === 'emevd') {
            for (const eventExport of bundle.events ?? []) {
                for (const event of eventExport.events) {
                    if (event.sourceUri !== target.sourceUri || event.eventId !== target.eventId)
                        continue;
                    candidates.push({
                        uri: event.uri, label: `event ${event.eventId}`,
                        discriminators: { eventId: event.eventId },
                        identity: identityOf(event, 'emevd', { eventId: event.eventId })
                    });
                }
            }
        }
        else if (target.domain === 'script') {
            const wanted = target.childChain.join('/');
            for (const scriptExport of bundle.scripts ?? []) {
                if (scriptExport.sourceUri !== target.sourceUri)
                    continue;
                for (const child of scriptExport.scripts) {
                    if (child.childChain.join('/') !== wanted)
                        continue;
                    if (target.scriptEntryIndex !== undefined && child.entryIndex !== target.scriptEntryIndex)
                        continue;
                    candidates.push({
                        uri: child.uri, label: child.entryName ?? wanted,
                        discriminators: { childChain: child.childChain },
                        identity: identityForUri(child.uri, bundle, workspaceId)
                    });
                }
            }
        }
        else if (target.domain === 'fmg') {
            for (const msgExport of bundle.msgs ?? []) {
                for (const entry of msgExport.entries) {
                    if (entry.sourceUri !== target.sourceUri || entry.textId !== target.textId)
                        continue;
                    if (entry.category !== target.category)
                        continue;
                    if (target.childChain.length > 0 && entry.category !== target.childChain.at(-1))
                        continue;
                    if (target.language !== undefined && entry.language !== target.language)
                        continue;
                    if (target.entryIndex !== undefined && entry.entryIndex !== target.entryIndex)
                        continue;
                    candidates.push({
                        uri: entry.uri, label: `${entry.category ?? ''}/${entry.textId}`,
                        discriminators: { textId: entry.textId },
                        identity: identityForUri(entry.uri, bundle, workspaceId)
                    });
                }
            }
        }
        else if (target.domain === 'map') {
            // A map entity answers to more than its native internalEntryId. resolve_entity accepts
            // `<mapId>#<name>` as an exact handle and search_map_entities returns `map://<mapId>/part/<name>`;
            // resolving only internalEntryId made every one of those keys an insufficient_evidence answer.
            const wantedKey = decodeMapTargetKey(target.nativeObjectKey);
            const pushMatch = (entity, address) => {
                candidates.push({
                    uri: entity.uri,
                    label: entity.name,
                    discriminators: {
                        nativeObjectKey: target.nativeObjectKey,
                        matchedKey: wantedKey,
                        // 重名实体的两种地址：地址（带 @0x，可直接回填 target）与 uri（引用图句柄）。
                        address,
                        uri: entity.uri,
                        ...(entity.nativeOffset === undefined ? {} : { nativeOffset: entity.nativeOffset }),
                        ...(entity.internalEntryId === undefined ? {} : { internalEntryId: entity.internalEntryId }),
                        ...(entity.entityId === undefined ? {} : { entityId: entity.entityId })
                    },
                    identity: identityForUri(entity.uri, bundle, workspaceId)
                });
            };
            const collectExport = (mapExport) => {
                // 地址必须按整张图的实体表判定重名；只看单条会漏掉同名兄弟。
                const addresses = formatMapEntityAddresses(mapExport.mapId, mapExport.entities);
                mapExport.entities.forEach((entity, index) => {
                    if (!mapTargetKeyMatches(entity, wantedKey))
                        return;
                    pushMatch(entity, addresses[index]);
                });
            };
            for (const mapExport of bundle.maps ?? []) {
                if (!mapExport.entities.some((entity) => entity.sourceUri === target.sourceUri))
                    continue;
                collectExport(mapExport);
            }
            // A key that names its own map (`<mapId>#<name>` or `map://<mapId>/…`) identifies the entity
            // even when the caller's sourceUri spelling differs from the indexed one.
            if (candidates.length === 0) {
                // `map://<mapId>/part/<name>@0x…` 与 `<mapId>#<name>@0x…` 都带自己的地图名。
                const mapIdFromKey = /^map:\/\/([^/]+)\//u.exec(wantedKey)?.[1]
                    ?? (/^([^#\s]+)#/u.exec(wantedKey)?.[1]);
                if (mapIdFromKey !== undefined) {
                    for (const mapExport of bundle.maps ?? []) {
                        if (mapExport.mapId !== mapIdFromKey)
                            continue;
                        collectExport(mapExport);
                    }
                }
            }
        }
        else if (target.domain === 'tae') {
            for (const tae of bundle.tae ?? []) {
                if (tae.sourceUri !== target.sourceUri)
                    continue;
                for (const animation of tae.animations) {
                    if (animation.animId !== target.animId)
                        continue;
                    if (animation.taeEntryIndex !== target.taeEntryIndex)
                        continue;
                    if (target.childChain.length > 0) {
                        const child = animation.taeEntryName ?? animation.taeGroup;
                        if (child === undefined || child !== target.childChain.at(-1))
                            continue;
                    }
                    if (target.eventIndex !== undefined) {
                        const hasEvent = animation.events?.some((event) => event.index === target.eventIndex);
                        if (!hasEvent)
                            continue;
                    }
                    candidates.push({
                        uri: target.eventIndex === undefined
                            ? `${tae.sourceUri}#anim/${animation.animId}@${animation.taeEntryIndex}`
                            : animation.events?.find((event) => event.index === target.eventIndex)?.uri
                                ?? `${tae.sourceUri}#anim/${animation.animId}@${animation.taeEntryIndex}/e${target.eventIndex}`,
                        label: animation.code,
                        discriminators: { taeEntryIndex: animation.taeEntryIndex },
                        identity: {
                            workspaceId, domain: 'tae', sourceUri: tae.sourceUri,
                            animId: animation.animId,
                            ...(animation.taeEntryIndex === undefined ? {} : { taeEntryIndex: animation.taeEntryIndex }),
                            ...(target.eventIndex === undefined ? {} : { eventIndex: target.eventIndex })
                        }
                    });
                }
            }
        }
        // objectHandle: host-issued lookup only; cannot resolve without a handle map.
        return candidates.length === 1 ? { uri: candidates[0].uri, candidates } : { candidates };
    }
    function resolveUri(uri) {
        // The same table reaches the bundle under more than one name (native NPC_PARAM_ST and catalog
        // NpcParam), and each export writes its own uri shape, so an exact string match made a search hit
        // like param://NPC_PARAM_ST/98500024 unresolvable even though the row was in the snapshot. Parse
        // the logical row address, then find the row by table alias + id and return its own uri.
        function resolveParamRowUri(uri, candidates) {
            const match = /^param:\/\/([^/]+)\/(\d+)(?:@\d+)?$/u.exec(uri.trim());
            if (match === null)
                return false;
            const normalize = (value) => value.replace(/\.param$/iu, '').replaceAll('_', '').toLowerCase();
            const table = normalize(match[1]);
            const rowId = Number(match[2]);
            for (const paramExport of queryBundle.params ?? []) {
                if (normalize(paramExport.paramName ?? '') !== table && normalize(paramExport.entryName ?? '') !== table)
                    continue;
                for (const row of paramExport.rows) {
                    if (row.rowId !== rowId)
                        continue;
                    candidates.push({ uri: row.uri, label: `${paramExport.paramName}#${row.rowId}`, discriminators: { sourceUri: paramExport.sourceUri ?? '', rowId }, identity: identityForUri(row.uri, queryBundle, workspaceId) });
                }
            }
            return candidates.length > 0;
        }
        const bundle = queryBundle;
        const candidates = [];
        const identity = () => identityForUri(uri, bundle, workspaceId);
        if (resolveParamRowUri(uri, candidates))
            return candidates.length === 1 ? { uri: candidates[0].uri, candidates } : { candidates };
        for (const paramExport of bundle.params ?? []) {
            for (const row of paramExport.rows)
                if (row.uri === uri)
                    candidates.push({ uri: row.uri, label: `${paramExport.paramName}#${row.rowId}`, discriminators: { rowId: row.rowId }, identity: identity() });
        }
        for (const eventExport of bundle.events ?? []) {
            for (const event of eventExport.events)
                if (event.uri === uri)
                    candidates.push({ uri: event.uri, label: `event ${event.eventId}`, discriminators: { eventId: event.eventId }, identity: identity() });
        }
        for (const mapExport of bundle.maps ?? []) {
            for (const entity of mapExport.entities)
                if (entity.uri === uri)
                    candidates.push({ uri: entity.uri, label: entity.name, discriminators: {}, identity: identity() });
            for (const region of mapExport.regions)
                if (region.uri === uri)
                    candidates.push({ uri: region.uri, label: region.name, discriminators: {}, identity: identity() });
        }
        for (const msgExport of bundle.msgs ?? []) {
            for (const entry of msgExport.entries)
                if (entry.uri === uri)
                    candidates.push({ uri: entry.uri, label: `${entry.category ?? ''}/${entry.textId}`, discriminators: { textId: entry.textId }, identity: identity() });
        }
        for (const scriptExport of bundle.scripts ?? []) {
            for (const child of scriptExport.scripts)
                if (child.uri === uri)
                    candidates.push({ uri: child.uri, label: child.entryName ?? '', discriminators: {}, identity: identity() });
        }
        // A map uri without an exact match is still a native handle: `…/part/<name>` for a
        // duplicated name means "candidates", while `…/part/<name>@0x<offset>` selects one.
        // Matching only entity.uri made a duplicated name silently resolve to whichever
        // entity happened to own the un-suffixed uri.
        if (candidates.length === 0) {
            const mapUri = /^map:\/\/([^/]+)\/(part|region)\/([^/?#]+)$/iu.exec(uri.trim());
            if (mapUri !== null) {
                const [, mapId, family, segment] = mapUri;
                const offset = parseMapOffsetSuffix(uri.trim());
                const name = offset?.name ?? decodeMapTargetKey(segment);
                for (const mapExport of bundle.maps ?? []) {
                    if (mapExport.mapId !== mapId)
                        continue;
                    const symbols = family.toLowerCase() === 'part' ? mapExport.entities : mapExport.regions;
                    const addresses = formatMapEntityAddresses(mapExport.mapId, symbols);
                    symbols.forEach((entity, index) => {
                        if (entity.name !== name)
                            return;
                        if (offset !== null && entity.nativeOffset !== offset.nativeOffset)
                            return;
                        candidates.push({
                            uri: entity.uri,
                            label: entity.name,
                            discriminators: {
                                address: addresses[index],
                                ...(entity.nativeOffset === undefined ? {} : { nativeOffset: entity.nativeOffset }),
                                ...(entity.entityId === undefined ? {} : { entityId: entity.entityId })
                            },
                            identity: identityForUri(entity.uri, bundle, workspaceId)
                        });
                    });
                }
            }
        }
        // A host may resolve a table/file/container before asking for content
        // references. Preserve a source-only root instead of treating the file as
        // absent merely because it has no child symbol in this snapshot.
        if (candidates.length === 0) {
            const sourceUris = new Set();
            for (const item of bundle.params ?? [])
                if (item.sourceUri)
                    sourceUris.add(item.sourceUri);
            for (const item of bundle.events ?? [])
                for (const event of item.events)
                    sourceUris.add(event.sourceUri);
            for (const item of bundle.maps ?? []) {
                for (const entity of item.entities)
                    sourceUris.add(entity.sourceUri);
                for (const region of item.regions)
                    sourceUris.add(region.sourceUri);
            }
            for (const item of bundle.msgs ?? [])
                for (const entry of item.entries)
                    sourceUris.add(entry.sourceUri);
            for (const item of bundle.scripts ?? [])
                sourceUris.add(item.sourceUri);
            for (const item of bundle.tae ?? [])
                sourceUris.add(item.sourceUri);
            if (sourceUris.has(uri)) {
                candidates.push({ uri, label: uri, discriminators: { sourceUri: uri }, identity: identity() });
            }
        }
        return candidates.length === 1 ? { uri: candidates[0].uri, candidates } : { candidates };
    }
    /**
     * Bundle-scoped query fallback (no host resolver): parses the table name and
     * row id out of the query text and applies the SAME exact-identity
     * collection as `target`. Multiple physical matches → ambiguous with full
     * discriminators; never a deep read of candidates (步骤 3).
     */
    function resolveQueryInBundle(query, domain) {
        const bundle = queryBundle;
        const match = /^([A-Za-z0-9_.]+)\s+(\d+)$/u.exec(query.trim());
        if (domain === 'param' && match) {
            const table = match[1].replace(/\.param$/iu, '').toLowerCase();
            const rowId = Number(match[2]);
            const candidates = [];
            for (const paramExport of bundle.params ?? []) {
                const entryTable = (paramExport.entryName ?? paramExport.paramName).replace(/\.param$/iu, '').toLowerCase();
                if (entryTable !== table && paramExport.paramName.toLowerCase() !== table)
                    continue;
                for (const row of paramExport.rows) {
                    if (row.rowId !== rowId)
                        continue;
                    candidates.push({
                        uri: row.uri,
                        label: `${paramExport.paramName}#${row.rowId}`,
                        discriminators: {
                            entryIndex: paramExport.entryIndex,
                            ...(row.rowIndex !== undefined ? { rowIndex: row.rowIndex } : {}),
                            ...(row.dataHash ? { dataHash: row.dataHash } : {})
                        },
                        identity: identityOf(row, 'param', {
                            ...(paramExport.entryIndex !== undefined ? { entryIndex: paramExport.entryIndex } : {}),
                            rowId: row.rowId,
                            ...(row.rowIndex !== undefined ? { rowIndex: row.rowIndex } : {})
                        })
                    });
                }
            }
            if (candidates.length === 1)
                return { resolution: 'resolved', uri: candidates[0].uri, candidates };
            if (candidates.length > 1)
                return { resolution: 'ambiguous', candidates };
            return { resolution: 'not_found' };
        }
        return { resolution: 'insufficient_evidence' };
    }
    function targetReadFor(uri, fieldIds) {
        if (!uri || !fieldIds)
            return { fields: [], completeness: 'summary_only' };
        const bundle = queryBundle;
        const fields = [];
        for (const paramExport of bundle.params ?? []) {
            for (const row of paramExport.rows) {
                if (row.uri !== uri)
                    continue;
                for (const fieldId of fieldIds) {
                    const field = (row.fields ?? []).find((item) => (item.fieldId ?? item.name) === fieldId);
                    if (field) {
                        fields.push({
                            fieldId,
                            value: field.value,
                            rowId: row.rowId,
                            ...(row.rowIndex !== undefined ? { rowIndex: row.rowIndex } : {}),
                            ...(row.dataHash ? { dataHash: row.dataHash } : {})
                        });
                    }
                }
                const found = new Set(fields.map((field) => field.fieldId));
                return {
                    fields,
                    // This is an indexed candidate, never a native proof. Even when all
                    // requested fields are present, a writer must perform read_param_fields.
                    completeness: found.size === fieldIds.length ? 'summary_only' : 'partial',
                    ...(fieldIds.filter((fieldId) => !found.has(fieldId)).length > 0
                        ? { missingFieldIds: fieldIds.filter((fieldId) => !found.has(fieldId)) }
                        : {})
                };
            }
        }
        return { fields: [], completeness: 'summary_only' };
    }
    function indirectEdgeKeys(rootUri, depth) {
        const keys = new Set();
        if (!options.registry && !rootUri.includes('#event/'))
            return keys;
        const chain = buildEventCallChain(queryBundle.events ?? [], rootUri, {
            maxDepth: Math.min(depth, 4),
            ...(options.registry ? { registry: options.registry } : {})
        });
        for (const path of chain.paths) {
            for (const hop of path) {
                if (hop.indirect) {
                    keys.add(edgeIdentityKey(hop.fromEventUri, hop.toEventUri, 'calls_event', hop.instructionUri));
                }
            }
        }
        return keys;
    }
    function contextFor(rootUri, relations, targetRead) {
        const statements = [];
        const evidence = [];
        const seenStatements = new Set();
        const seenEvidence = new Set();
        for (const relation of relations) {
            for (const item of relation.evidence) {
                const evidenceKey = JSON.stringify(item);
                if (!seenEvidence.has(evidenceKey) && evidence.length < 32) {
                    seenEvidence.add(evidenceKey);
                    evidence.push(item);
                }
                const statement = item.statement;
                if (statement) {
                    const statementKey = `${statement.kind}\u0000${statement.text}`;
                    if (!seenStatements.has(statementKey) && statements.length < 32) {
                        seenStatements.add(statementKey);
                        statements.push(statement);
                    }
                }
            }
        }
        for (const field of targetRead.fields) {
            const statement = {
                kind: 'field-assignment',
                text: `${field.fieldId} = ${JSON.stringify(field.value)}`,
                location: { fieldId: field.fieldId }
            };
            if (statements.length < 32)
                statements.push(statement);
        }
        return {
            target: identityForUri(rootUri, queryBundle, workspaceId),
            statements,
            evidence
        };
    }
    const CONTAINER_BOUNDARY_KINDS = new Set(['contains', 'member_of']);
    function sourceOf(uri) {
        return uri.split('#')[0] ?? uri;
    }
    function edgeStableSort(a, b) {
        return a.fromUri.localeCompare(b.fromUri)
            || a.toUri.localeCompare(b.toUri)
            || a.kind.localeCompare(b.kind)
            || a.reason.localeCompare(b.reason)
            || (a.evidence[0]?.sourceUri ?? '').localeCompare(b.evidence[0]?.sourceUri ?? '');
    }
    /**
     * Traverse only the requested direction and depth. Container membership is
     * a terminal fact: a root may show its own contains/member_of relation, but
     * the traversal never walks through the container to enumerate unrelated
     * siblings. Node, edge and source caps remain independent of page size.
     */
    function traverseBounded(rootUri, edges, direction, depth) {
        const outgoing = new Map();
        const incoming = new Map();
        for (const edge of edges) {
            const from = outgoing.get(edge.fromUri) ?? [];
            from.push(edge);
            outgoing.set(edge.fromUri, from);
            const to = incoming.get(edge.toUri) ?? [];
            to.push(edge);
            incoming.set(edge.toUri, to);
        }
        for (const list of outgoing.values())
            list.sort(edgeStableSort);
        for (const list of incoming.values())
            list.sort(edgeStableSort);
        const queue = [{ uri: rootUri, depth: 0, path: [] }];
        const visited = new Set([rootUri]);
        const selected = new Map();
        const paths = new Map();
        const indirectEdgeKeys = new Set();
        const scannedSources = new Set([sourceOf(rootUri)]);
        let truncated = false;
        let truncationReason;
        let expansionEdges = 0;
        const candidatesFor = (uri) => {
            if (direction === 'from')
                return outgoing.get(uri) ?? [];
            if (direction === 'to')
                return incoming.get(uri) ?? [];
            const combined = new Map();
            for (const edge of [...(outgoing.get(uri) ?? []), ...(incoming.get(uri) ?? [])]) {
                const key = `${edge.fromUri}\u0000${edge.toUri}\u0000${edge.kind}\u0000${edge.evidence[0]?.sourceUri ?? ''}`;
                if (!combined.has(key))
                    combined.set(key, edge);
            }
            return [...combined.values()].sort(edgeStableSort);
        };
        const nextFor = (uri, edge) => {
            if (direction === 'from')
                return edge.fromUri === uri ? edge.toUri : undefined;
            if (direction === 'to')
                return edge.toUri === uri ? edge.fromUri : undefined;
            if (edge.fromUri === uri)
                return edge.toUri;
            if (edge.toUri === uri)
                return edge.fromUri;
            return undefined;
        };
        while (queue.length > 0) {
            const current = queue.shift();
            if (current.depth >= depth) {
                const hasUnvisitedBeyondDepth = candidatesFor(current.uri).some((edge) => {
                    if (CONTAINER_BOUNDARY_KINDS.has(edge.kind))
                        return false;
                    const nextUri = nextFor(current.uri, edge);
                    return nextUri !== undefined && !visited.has(nextUri);
                });
                if (hasUnvisitedBeyondDepth) {
                    truncated = true;
                    truncationReason = `达到查询深度上限 ${depth}；已停止继续遍历。`;
                }
                continue;
            }
            for (const edge of candidatesFor(current.uri)) {
                if (expansionEdges >= maxTraversalEdges) {
                    truncated = true;
                    truncationReason = `达到关联边上限 ${maxTraversalEdges}；已停止继续遍历。`;
                    break;
                }
                expansionEdges += 1;
                const nextUri = nextFor(current.uri, edge);
                if (!nextUri)
                    continue;
                const nextSource = sourceOf(nextUri);
                if (!scannedSources.has(nextSource) && scannedSources.size >= maxSources) {
                    truncated = true;
                    truncationReason = `达到来源上限 ${maxSources}；已停止继续遍历。`;
                    continue;
                }
                if (!visited.has(nextUri) && visited.size >= maxTraversalNodes) {
                    truncated = true;
                    truncationReason = `达到关联节点上限 ${maxTraversalNodes}；已停止继续遍历。`;
                    continue;
                }
                const key = `${edge.fromUri}\u0000${edge.toUri}\u0000${edge.kind}\u0000${edge.evidence[0]?.sourceUri ?? ''}`;
                const hopCertainty = certaintyForEdge(edge, current.path.length > 0);
                // A hop describes the EDGE, not the walking direction. Under direction:"to"
                // the walk goes target→referrer, which used to emit path[0].from=target while
                // the relation it belongs to reads referrer→target: the two disagreed.
                const hop = {
                    from: identityForUri(edge.fromUri, queryBundle, workspaceId),
                    to: identityForUri(edge.toUri, queryBundle, workspaceId),
                    relationKind: edge.kind,
                    certainty: hopCertainty
                };
                const path = [...current.path, hop];
                if (!selected.has(key)) {
                    selected.set(key, edge);
                    paths.set(key, path);
                    if (path.length > 1 || hopCertainty === 'indirect')
                        indirectEdgeKeys.add(key);
                }
                scannedSources.add(sourceOf(edge.fromUri));
                scannedSources.add(sourceOf(edge.toUri));
                // Membership edges are intentionally terminal. A container relation
                // can be displayed when directly attached to the root but never fans
                // out into all children/siblings.
                if (CONTAINER_BOUNDARY_KINDS.has(edge.kind))
                    continue;
                if (current.depth + 1 > depth || visited.has(nextUri))
                    continue;
                visited.add(nextUri);
                scannedSources.add(nextSource);
                queue.push({ uri: nextUri, depth: current.depth + 1, path });
            }
            if (truncated && expansionEdges >= maxTraversalEdges)
                break;
        }
        return {
            edges: [...selected.values()],
            paths,
            indirectEdgeKeys,
            scannedSources,
            truncated,
            ...(truncationReason ? { truncationReason } : {})
        };
    }
    /** Echo the selector an exact-target query tried, so a miss names what was searched. */
    function describeTargetSelector(selector) {
        if (selector === null || typeof selector !== 'object')
            return '未识别的 target';
        const value = selector;
        const parts = [];
        if (typeof value.domain === 'string')
            parts.push(`domain=${value.domain}`);
        if (typeof value.sourceUri === 'string')
            parts.push(`sourceUri=${value.sourceUri}`);
        for (const key of ['entryIndex', 'rowId', 'rowIndex', 'textId', 'eventId', 'taeEntryIndex', 'animId', 'eventIndex']) {
            if (typeof value[key] === 'number')
                parts.push(`${key}=${String(value[key])}`);
        }
        if (Array.isArray(value.childChain))
            parts.push(`childChain=${value.childChain.join('/')}`);
        if (typeof value.category === 'string')
            parts.push(`category=${value.category}`);
        if (typeof value.nativeObjectKey === 'string')
            parts.push(`nativeObjectKey=${value.nativeObjectKey}`);
        if (typeof value.objectHandle === 'string')
            parts.push(`objectHandle=${value.objectHandle}`);
        return parts.length === 0 ? '未识别的 target' : parts.join(', ');
    }
    function insufficientRecord(message) {
        return {
            resolution: 'insufficient_evidence',
            relations: [],
            coverage: buildCoverage({ bundle: queryBundle, scannedDomains: [], truncated: false, coverageStates: options.coverageStates }),
            page: { returnedCount: 0, hasMore: false },
            ...(options.scan ? { scan: options.scan } : {}),
            diagnostics: [...(options.sourceDiagnostics ?? []), { severity: 'warning', code: 'REFERENCE_INSUFFICIENT_EVIDENCE', message }],
            nextActions: []
        };
    }
    async function query(input) {
        const decoded = decodeReferenceQueryInput(input);
        if (!decoded.ok) {
            throw Object.assign(new Error(decoded.message), { code: decoded.code, field: decoded.field });
        }
        let normalized = decoded.input;
        let offset = 0;
        let cursorRegistration;
        // Native sources may finish in different orders during cold analysis.
        // Canonicalize only export groups; physical row/instruction/field order is
        // retained. Providers and the cursor fingerprint see the same snapshot.
        const __t0 = Date.now();
        const snapshot = canonicalBundleSnapshot(options.bundle);
        const __t1 = Date.now();
        queryBundle = snapshot.bundle;
        const currentSourceVersionKey = snapshot.key;
        const currentDependencySummary = buildDependencySummary(queryBundle);
        const __t2 = Date.now();
        if (process.env.SOULFORGE_DEBUG_REF === '1')
            console.error(`[ref:timing] snapshot=${__t1 - __t0}ms depSummary=${__t2 - __t1}ms`);
        if (normalized.cursor) {
            const registration = cursorStore.get(normalized.cursor);
            if (!registration) {
                throw Object.assign(new Error('游标未由当前宿主签发或已过期；请重新发起查询。'), { code: 'REFERENCE_CURSOR_SCOPE_MISMATCH' });
            }
            if (registration.sourceScanState !== undefined) {
                throw Object.assign(new Error('该游标属于来源 enrichment 扫描，不能作为关联结果分页游标使用；请通过 sourceCursor 续扫。'), { code: 'REFERENCE_CURSOR_KIND_MISMATCH' });
            }
            if (registration.workspaceId !== workspaceId) {
                throw Object.assign(new Error('游标属于其他 workspace。'), { code: 'REFERENCE_CURSOR_SCOPE_MISMATCH' });
            }
            if (!explicitCursorScopeMatches(input, normalized, registration.scope)) {
                throw Object.assign(new Error('游标查询条件与首次查询不一致；请沿用原 scope 续页。'), { code: 'REFERENCE_CURSOR_SCOPE_MISMATCH' });
            }
            if (registration.sourceVersionKey !== currentSourceVersionKey
                || registration.providerRegistryDigest !== options.providerRegistryDigest
                || !dependencySummariesMatch(registration.dependencySummary, currentDependencySummary)) {
                throw Object.assign(new Error('来源版本在分页期间变化；旧游标失效，请重新查询。'), { code: 'REFERENCE_CURSOR_SCOPE_MISMATCH' });
            }
            cursorRegistration = registration;
            offset = registration.relationOffset;
            // Omitted continuation fields inherit the exact original scope,
            // including direction/detail/depth/limit/includeHypotheses.
            normalized = {
                ...registration.scope,
                cursor: normalized.cursor,
                cursorScopeCheckRequired: true
            };
        }
        const limit = normalized.limit ?? REFERENCE_LIMIT_DEFAULT;
        const depth = normalized.depth ?? REFERENCE_DEPTH_DEFAULT;
        // --- Steps 2-3: resolve the root. ---
        let rootUri;
        const resolution = 'resolved';
        if (cursorRegistration) {
            rootUri = cursorRegistration.rootUri;
            if (!rootUri) {
                return insufficientRecord('游标登记的根目标在当前快照中不再唯一或已消失。');
            }
        }
        else if (normalized.target) {
            const exact = resolveExactTarget(normalized.target);
            if (exact.uri === undefined) {
                if (exact.candidates.length > 1) {
                    return {
                        resolution: 'ambiguous',
                        candidates: exact.candidates.map((item) => ({
                            identity: item.identity,
                            discriminators: item.discriminators
                        })),
                        relations: [],
                        coverage: buildCoverage({ bundle: queryBundle, scannedDomains: [], truncated: false, coverageStates: options.coverageStates }),
                        page: { returnedCount: 0, hasMore: false },
                        diagnostics: [{ severity: 'info', code: 'REFERENCE_TARGET_AMBIGUOUS', message: '同名/同 id 多候选；地图重名 part/region 请按候选 discriminators.address（带 @0x 偏移）选定后重查。第一步不对候选深读。' }],
                        nextActions: exact.candidates.slice(0, 8).map((item) => {
                            const address = typeof item.discriminators.address === 'string' ? item.discriminators.address : undefined;
                            return {
                                tool: 'find_references',
                                args: address === undefined
                                    ? { uri: item.uri, detail: 'edges' }
                                    : { target: { domain: 'map', sourceUri: item.identity.sourceUri, nativeObjectKey: address }, detail: 'edges' },
                                reason: `对候选 ${item.label}${address === undefined ? '' : `（${address}）`} 重新发起精确查询`
                            };
                        })
                    };
                }
                const mapTarget = normalized.target !== undefined && 'domain' in normalized.target && normalized.target.domain === 'map'
                    ? normalized.target
                    : undefined;
                // A duplicated MSB name is reported as `ambiguous` by the collector above; the index now
                // carries nativeOffset, so an `@0x<offset>` address selects exactly one entity.
                const offsetAddress = mapTarget !== undefined && /@0x[0-9a-f]+$/iu.test(mapTarget.nativeObjectKey);
                const mapHint = mapTarget === undefined
                    ? ''
                    : ' map target 的 nativeObjectKey 接受 internalEntryId、实体名、<mapId>#<name>、<mapId>#<name>@0x<offset>、'
                        + 'search_map_entities 返回的 map://<mapId>/part/<name>（重名时带 @0x<offset>）或数字 entityId。'
                        + (offsetAddress
                            ? ' 该 @0x 地址没有命中任何索引实体：请确认偏移与当前文件版本一致，'
                                + '或用 search_map_entities 查看同一地图返回的 nativeOffset/address 后重试。'
                            : ' 同名实体不带 @0x 时会报 ambiguous 并列出候选地址，不会静默取第一条。');
                return insufficientRecord(`精确 target 在当前索引快照中没有唯一命中（${describeTargetSelector(normalized.target)}）；不触发盲猜扫描。可用 resolve_entity，或先读取该文件确认标识形式。${mapHint}`);
            }
            rootUri = exact.uri;
        }
        else if (normalized.uri) {
            // The same table has two names: the native schema name (ITEMLOT_PARAM_ST) that search_param_rows
            // returns and the catalog name (ItemLotParam) the index uses. Comparing names for existence was not
            // enough — the row lookup still used the token as typed, so the alias hit resolved nothing. Rewrite
            // the table token to the name the index holds before resolving.
            const aliasKeyOf = (value) => value.replace(/\.param$/iu, '').replaceAll('_', '').toLowerCase().replace(/st$/u, '');
            const paramToken = /^param:\/\/([^/]+)\/(\d+)(@\d+)?$/u.exec(normalized.uri.trim());
            let lookupUri = normalized.uri;
            if (paramToken !== null) {
                const wanted = aliasKeyOf(paramToken[1]);
                const held = (queryBundle.params ?? []).find((item) => item.paramName !== undefined && aliasKeyOf(item.paramName) === wanted);
                if (held?.paramName !== undefined && held.paramName !== paramToken[1])
                    lookupUri = `param://${held.paramName}/${paramToken[2]}${paramToken[3] ?? ''}`;
            }
            const byUri = resolveUri(lookupUri);
            if (byUri.uri === undefined) {
                if (byUri.candidates.length > 1) {
                    return {
                        resolution: 'ambiguous',
                        candidates: byUri.candidates.map((item) => ({
                            identity: item.identity,
                            discriminators: item.discriminators
                        })),
                        relations: [],
                        coverage: buildCoverage({ bundle: queryBundle, scannedDomains: [], truncated: false, coverageStates: options.coverageStates }),
                        page: { returnedCount: 0, hasMore: false },
                        diagnostics: [{ severity: 'info', code: 'REFERENCE_TARGET_AMBIGUOUS', message: '逻辑 URI 不能唯一解析，返回候选。' }],
                        nextActions: []
                    };
                }
                // A param:// row address can fail for three different reasons that all looked the same: the
                // table is not in the snapshot, the table is there under another alias, or the row exists only
                // in the file because rows enter the index when a read happens in the same session. Say which.
                const paramMatch = /^param:\/\/([^/]+)\/(\d+)(?:@\d+)?$/u.exec(normalized.uri.trim());
                if (paramMatch !== null) {
                    const normalize = (value) => value.replace(/\.param$/iu, '').replaceAll('_', '').toLowerCase();
                    const table = normalize(paramMatch[1]);
                    const rowId = Number(paramMatch[2]);
                    // The native schema name carries a _ST suffix (ITEMLOT_PARAM_ST) while the catalog name does not
                    // (ItemLotParam), so an exact comparison denied a table the index clearly holds.
                    const aliasKey = (value) => normalize(value).replace(/st$/u, '');
                    const tableKey = aliasKey(paramMatch[1]);
                    const exports = (queryBundle.params ?? []).filter((item) => normalize(item.paramName ?? '') === table || normalize(item.entryName ?? '').endsWith(table)
                        || aliasKey(item.paramName ?? '') === tableKey || aliasKey(item.entryName ?? '').endsWith(tableKey));
                    const rowsHeld = exports.reduce((total, item) => total + item.rows.length, 0);
                    const aliases = [...new Set(exports.map((item) => item.paramName))].filter(Boolean).join(' / ');
                    // Native schema names and catalog names differ (NPC_PARAM_ST vs NpcParam). Point at the
                    // nearest name the snapshot does hold instead of only denying the one that was asked for.
                    const nearest = exports.length === 0
                        ? [...new Set((queryBundle.params ?? []).map((item) => item.paramName ?? ''))]
                            .filter((name) => name !== '' && (table.startsWith(normalize(name)) || normalize(name).startsWith(table)))
                            .slice(0, 3)
                        : [];
                    const detail = exports.length === 0
                        ? `索引里没有名为 ${paramMatch[1]} 的表`
                            + (nearest.length > 0 ? `；最接近的是 ${nearest.join(' / ')}（原生表名与目录名可能不同，可用 param://${nearest[0]}/<rowId> 重试）` : '')
                            + '。索引持有的行地址形如 param://<表名>/<rowId>，或 read_param_fields 返回的 file://…#<表>/<rowId>@<rowIndex>。'
                        : `表在索引中有 ${exports.length} 个来源（${aliases}，共 ${rowsHeld} 行），但没有 rowId ${rowId} 的那一行；某些行只有在同一 session 内 read_param_fields 读过之后才会进入索引。`;
                    return {
                        resolution: 'insufficient_evidence',
                        relations: [],
                        coverage: buildCoverage({ bundle: queryBundle, scannedDomains: [], truncated: false, coverageStates: options.coverageStates }),
                        page: { returnedCount: 0, hasMore: false },
                        diagnostics: [{ severity: 'info', code: 'REFERENCE_ROOT_NOT_IN_INDEX', message: `URI ${normalized.uri} 不能解析：${detail}` }],
                        nextActions: exports.length > 0
                            ? [{ tool: 'find_references', args: { uri: exports[0].sourceUri, detail: 'edges' }, reason: '先看该表所属文件级引用；行级引用需要先在同一 session 内读取该行' }]
                            : []
                    };
                }
                return insufficientRecord(`URI ${normalized.uri} 不在当前索引快照中；缺少 index/原生来源时返回缺失条件。`);
            }
            rootUri = byUri.uri;
        }
        else if (normalized.query) {
            const resolved = options.resolveQuery
                ? await options.resolveQuery(normalized.query, normalized.domain)
                : resolveQueryInBundle(normalized.query, normalized.domain);
            if (resolved.resolution === 'ambiguous') {
                return {
                    resolution: 'ambiguous',
                    candidates: (resolved.candidates ?? []).map((item) => ({
                        identity: item.identity ?? identityForUri(item.uri, queryBundle, workspaceId),
                        discriminators: item.discriminators
                    })),
                    relations: [],
                    coverage: buildCoverage({ bundle: queryBundle, scannedDomains: [], truncated: false, coverageStates: options.coverageStates }),
                    page: { returnedCount: 0, hasMore: false },
                    diagnostics: [{ severity: 'info', code: 'REFERENCE_QUERY_AMBIGUOUS', message: 'query 命中多个候选；第一步不深读，选定后重新查询。' }],
                    nextActions: (resolved.candidates ?? []).slice(0, 8).map((item) => ({
                        tool: 'find_references', args: { uri: item.uri, detail: 'edges' }, reason: `对候选 ${item.label} 精确查询`
                    }))
                };
            }
            if (resolved.resolution !== 'resolved' || !resolved.uri) {
                return insufficientRecord(`query「${normalized.query}」没有可验证的当前原生来源（${resolved.resolution}）。`);
            }
            rootUri = resolved.uri;
        }
        else {
            return insufficientRecord('缺少可解析的根目标。');
        }
        // --- Step 4: lock root version; read requested fields. ---
        const targetRead = targetReadFor(rootUri, normalized.fieldIds);
        // --- Step 5-6: source shards + bounded multi-hop traversal. ---
        const includeHypotheses = normalized.includeHypotheses === true;
        const shards = collectShards(includeHypotheses, currentSourceVersionKey);
        const direction = normalized.direction ?? 'both';
        // `low` is the graph confidence contract for candidate observations. Some
        // providers use a descriptive reason such as `unknown-api literal-match`
        // instead of the legacy `hypothesis(...)` prefix, so filtering by reason
        // alone leaks numeric/name candidates when hypotheses are disabled.
        const traversableEdges = shards.edges.filter((edge) => includeHypotheses || edge.confidence !== 'low');
        const traversal = traverseBounded(rootUri, traversableEdges, direction, depth);
        const connected = traversal.edges;
        const scanned = traversal.scannedSources;
        const indirectKeys = new Set(traversal.indirectEdgeKeys);
        if (rootUri.includes('#event/')) {
            for (const key of indirectEdgeKeys(rootUri, depth))
                indirectKeys.add(key);
        }
        const versions = collectSourceVersions(queryBundle);
        const relations = assembleRelations({
            edges: connected,
            bundle: queryBundle,
            workspaceId,
            versions,
            indirectEdgeKeys: indirectKeys,
            paths: traversal.paths
        });
        // --- Step 7-8: coverage + page projection. Context is built only from
        // the relations retained on this page, never from the full result set. ---
        const dependencySummary = currentDependencySummary;
        const truncated = traversal.truncated;
        const reserveContinuation = relations.length > offset + 1;
        const continuationReservation = reserveContinuation
            ? [{ tool: 'find_references', args: { cursor: REFERENCE_CURSOR_TOKEN_PLACEHOLDER }, reason: '使用该游标继续读取当前已锁定关联结果页。' }]
            : [];
        const baseRecord = {
            resolution,
            ...(rootUri ? {
                target: {
                    workspaceId,
                    domain: domainOfUri(rootUri, queryBundle),
                    sourceUri: rootUri
                }
            } : {}),
            detail: normalized.detail,
            ...(normalized.fieldIds ? { targetRead } : {}),
            ...(options.scan ? { scan: options.scan } : {}),
            relations,
            coverage: buildCoverage({ bundle: queryBundle, scannedDomains: [...scanned], truncated, coverageStates: options.coverageStates }),
            diagnostics: [
                ...(options.sourceDiagnostics ?? []),
                ...shards.diagnostics
                    .filter((diagnostic) => relatedToDiagnostic(diagnostic, connected, rootUri))
                    .map((diagnostic) => ({
                    severity: diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'info' ? 'info' : 'warning',
                    code: diagnostic.code,
                    message: diagnostic.message,
                    ...(diagnostic.sourceUri ? { sourceUri: diagnostic.sourceUri } : {})
                }))
            ].slice(0, 16),
            nextActions: truncated
                ? [{
                        tool: 'find_references',
                        args: freshQueryArgs(normalized),
                        reason: `${traversal.truncationReason ?? '关联遍历达到上限'}；该动作会重新执行当前有界查询，不是现有结果页续读，请缩小查询目标或由宿主提高受控遍历上限。`
                    }, ...continuationReservation]
                : continuationReservation
        };
        const built = buildBoundedPage({
            record: baseRecord,
            limit,
            offset,
            ...(normalized.detail === 'context' && rootUri
                ? { contextForPage: (pageRelations) => contextFor(rootUri, pageRelations, targetRead) }
                : {}),
            ...(reserveContinuation ? { nextCursorPlaceholder: REFERENCE_CURSOR_TOKEN_PLACEHOLDER } : {}),
            ...(traversal.truncationReason ? { truncationReason: traversal.truncationReason } : {})
        });
        const relationPageHasMore = offset + built.record.relations.length < relations.length;
        const nextCursor = relationPageHasMore
            ? cursorStore.issue({
                workspaceId,
                scope: cursorScopeFor(normalized),
                rootUri,
                relationOffset: offset + built.record.relations.length,
                sourceVersionKey: currentSourceVersionKey,
                dependencySummary,
                ...(options.providerRegistryDigest ? { providerRegistryDigest: options.providerRegistryDigest } : {})
            })
            : undefined;
        if (nextCursor) {
            built.record.page = {
                ...built.record.page,
                returnedCount: built.record.relations.length,
                hasMore: true,
                nextCursor,
                ...(traversal.truncationReason ? { truncationReason: traversal.truncationReason } : {})
            };
            built.record.nextActions = [
                ...built.record.nextActions.filter((action) => !(action.tool === 'find_references' && action.args.cursor === REFERENCE_CURSOR_TOKEN_PLACEHOLDER)),
                { tool: 'find_references', args: { cursor: nextCursor }, reason: '使用该游标继续读取当前已锁定关联结果页。' }
            ];
        }
        else if (traversal.truncationReason) {
            built.record.page = {
                ...built.record.page,
                ...(built.record.page.truncationReason ? {} : { truncationReason: traversal.truncationReason })
            };
        }
        built.record.nextActions = built.record.nextActions.filter((action) => action.args.cursor !== REFERENCE_CURSOR_TOKEN_PLACEHOLDER);
        return built.record;
    }
    function domainOfUri(uri, bundle) {
        if ((bundle.params ?? []).some((item) => item.sourceUri === uri || item.rows.some((row) => row.uri === uri)))
            return 'param';
        if ((bundle.events ?? []).some((item) => item.events.some((event) => event.sourceUri === uri || event.uri === uri)))
            return 'emevd';
        if ((bundle.maps ?? []).some((item) => item.entities.some((entity) => entity.sourceUri === uri || entity.uri === uri) || item.regions.some((region) => region.sourceUri === uri || region.uri === uri)))
            return 'map';
        if ((bundle.msgs ?? []).some((item) => item.entries.some((entry) => entry.sourceUri === uri || entry.uri === uri)))
            return 'fmg';
        if ((bundle.scripts ?? []).some((item) => item.sourceUri === uri || item.scripts.some((child) => child.uri === uri)))
            return 'script';
        if ((bundle.tae ?? []).some((item) => item.sourceUri === uri || item.animations.some((animation) => (animation.events.some((event) => event.uri === uri)
            || `${item.sourceUri}#anim/${animation.animId}@${animation.taeEntryIndex ?? 'x'}` === uri))))
            return 'tae';
        return 'resource';
    }
    function relatedToDiagnostic(diagnostic, edges, rootUri) {
        const details = diagnostic.details;
        const detailRecord = typeof details === 'object' && details !== null
            ? details
            : undefined;
        const relatedUris = new Set([
            ...(rootUri ? [rootUri] : []),
            ...edges.flatMap((edge) => [edge.fromUri, edge.toUri])
        ]);
        // Providers that know the physical row/event/script identity should attach
        // it here. This keeps unrelated diagnostics from the same source container
        // out of a focused reference query.
        for (const key of ['rowUri', 'eventUri', 'scriptUri', 'objectUri', 'uri']) {
            const value = detailRecord?.[key];
            if (typeof value === 'string')
                return relatedUris.has(value);
        }
        const rowId = detailRecord?.rowId;
        if (typeof rowId === 'number' && Number.isSafeInteger(rowId)) {
            return [...relatedUris].some((uri) => {
                const identity = identityForUri(uri, queryBundle, workspaceId);
                return identity.domain === 'param' && identity.rowId === rowId;
            });
        }
        if (diagnostic.sourceUri === undefined)
            return true;
        if (rootUri && diagnostic.sourceUri === rootUri)
            return true;
        return edges.some((edge) => edge.evidence.some((item) => item.sourceUri === diagnostic.sourceUri));
    }
    return {
        query,
        deliveredFieldProofs: () => [...fieldProofs]
    };
}
//# sourceMappingURL=referenceQueryService.js.map