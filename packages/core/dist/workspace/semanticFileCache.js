import { MSG_CATEGORY_PROJECTION_VERSION, TAE_IDENTITY_PROJECTION_VERSION } from '@soulforge/shared';
/**
 * Native semantic caches are only reusable when the cached projection carries
 * the same verified packed-file identity as the current catalog.  The source
 * revision must still exist as provenance, but it is rebound to the current
 * verified catalog revision on load. Older cache rows predate
 * outerFileHash/sourceRevision; treating those rows as a hit would silently
 * skip the Bridge export and leave RAG without a freshness proof. Text/JSON
 * fixture caches intentionally retain the historical cache behavior because
 * they are not native byte projections.
 */
export function isNativeSemanticBundleCurrent(file, bundle) {
    if (bundle.tae?.some((item) => item.readerSchemaRevision !== TAE_IDENTITY_PROJECTION_VERSION))
        return false;
    if (!isNativeSemanticCacheCandidate(file))
        return true;
    if (bundle.msgs?.some(item => item.readerSchemaRevision !== 2))
        return false;
    // Category identity is part of the projection, not just the decoded bytes:
    // pre-v1 bundles store lowercased table names (`npc名`) that cannot be
    // matched against native names (`NPC名`).  Re-export instead of publishing
    // an index whose tables look missing to every table-keyed consumer.
    if (bundle.msgs?.some(item => item.categoryProjectionVersion !== MSG_CATEGORY_PROJECTION_VERSION))
        return false;
    // MSB 允许同名 part：旧 map 投影没有 nativeOffset，`<mapId>#<name>` 因此不唯一，
    // 按地址/uri 建索引的消费方会丢条目或错配。这不是可修补的旧数据——当作缓存未命中，
    // 由 Bridge 原生读取重建（源文件不动）。调用方据此给出 MAP_INDEX_REBUILD_REQUIRED。
    if (hasLegacyMapProjectionWithoutNativeOffset(bundle))
        return false;
    if (!file.sha256)
        return false;
    const proven = [
        ...(bundle.events ?? []).flatMap((item) => [item, ...item.events]),
        ...(bundle.maps ?? []).flatMap((item) => [item, ...item.entities, ...item.regions]),
        ...(bundle.params ?? []).flatMap((item) => [item, ...item.rows]),
        ...(bundle.msgs ?? []).flatMap((item) => [item, ...item.entries]),
        ...(bundle.tae ?? []).flatMap((item) => [item, ...item.animations.flatMap((anim) => [item, ...anim.events])]),
        ...(bundle.scripts ?? []).flatMap((item) => [item, ...item.scripts])
    ];
    if (proven.length === 0)
        return false;
    return proven.every((value) => (
    // Content identity is the reuse authority.  A copied/restored workspace
    // may legitimately have a different mtime while containing the exact
    // same native bytes; forcing a Bridge export in that case defeats the
    // persistent-cache contract.  Callers rebase sourceRevision to the
    // current verified catalog revision before publishing the bundle.
    typeof value.sourceRevision === 'number'
        && value.outerFileHash === file.sha256));
}
/**
 * Rebind a verified cache payload to the current catalog revision.  The
 * payload is accepted only after isNativeSemanticBundleCurrent compared its
 * outer hash, so this changes freshness metadata, never decoded content or
 * native byte identity.
 */
export function rebaseSymbolBundleToFileRevision(file, bundle) {
    const sourceRevision = file.mtimeMs;
    return {
        ...(bundle.events ? {
            events: bundle.events.map((item) => ({
                ...item,
                sourceRevision,
                events: item.events.map((event) => ({ ...event, sourceRevision }))
            }))
        } : {}),
        ...(bundle.maps ? {
            maps: bundle.maps.map((item) => ({
                ...item,
                sourceRevision,
                entities: item.entities.map((entity) => ({ ...entity, sourceRevision })),
                regions: item.regions.map((region) => ({ ...region, sourceRevision }))
            }))
        } : {}),
        ...(bundle.params ? {
            params: bundle.params.map((item) => ({
                ...item,
                sourceRevision,
                rows: item.rows.map((row) => ({ ...row, sourceRevision }))
            }))
        } : {}),
        ...(bundle.msgs ? {
            msgs: bundle.msgs.map((item) => ({
                ...item,
                sourceRevision,
                entries: item.entries.map((entry) => ({ ...entry, sourceRevision }))
            }))
        } : {}),
        ...(bundle.tae ? {
            tae: bundle.tae.map((item) => ({
                ...item,
                sourceRevision,
                animations: item.animations.map((animation) => ({
                    ...animation,
                    events: animation.events.map((event) => ({ ...event, sourceRevision }))
                }))
            }))
        } : {}),
        ...(bundle.scripts ? {
            scripts: bundle.scripts.map((item) => ({
                ...item,
                sourceRevision,
                scripts: item.scripts.map((script) => ({ ...script, sourceRevision }))
            }))
        } : {})
    };
}
/**
 * True when a cached map projection predates nativeOffset identity. Only native part/
 * region symbols are checked; low-confidence `/entity/candidate_N` scans never carried
 * an offset and are not addressable entities.
 */
export function hasLegacyMapProjectionWithoutNativeOffset(bundle) {
    return (bundle.maps ?? []).some((item) => [...item.entities, ...item.regions].some((symbol) => ((typeof symbol.nativeOffset !== 'number' || !Number.isSafeInteger(symbol.nativeOffset))
        && /\/(?:part|region)\//u.test(symbol.uri))));
}
function isNativeSemanticCacheCandidate(file) {
    const path = file.relativePath.toLowerCase();
    if (path.endsWith('.tae') || path.endsWith('.tae.dcx') || path.includes('.anibnd'))
        return true;
    if (file.resourceKind === 'event')
        return path.includes('.emevd');
    if (file.resourceKind === 'map')
        return path.includes('.msb');
    if (file.resourceKind === 'param')
        return path.includes('.param');
    if (file.resourceKind === 'msg') {
        return path.endsWith('.fmg')
            || path.endsWith('.fmg.dcx')
            || path.includes('msgbnd')
            || path.includes('.msgbnd');
    }
    if (file.resourceKind === 'script' || file.resourceKind === 'ai') {
        return path.includes('.luabnd') || path.endsWith('.lua') || path.endsWith('.hks');
    }
    return false;
}
/**
 * Extract symbols belonging to a single file from the populated WorkspaceIndex.
 */
export function extractFileSymbolBundle(index, sourceUri) {
    const full = index.toSymbolBundle();
    const bundle = {};
    if (full.params && full.params.length > 0) {
        const params = [];
        for (const item of full.params) {
            if (item.sourceUri === sourceUri) {
                params.push(item);
            }
            else {
                const rows = item.rows.filter((row) => row.sourceUri === sourceUri);
                if (rows.length > 0) {
                    params.push({ ...item, rows });
                }
            }
        }
        if (params.length > 0)
            bundle.params = params;
    }
    if (full.msgs && full.msgs.length > 0) {
        const msgs = [];
        for (const item of full.msgs) {
            const entries = item.entries.filter((entry) => entry.sourceUri === sourceUri);
            if (entries.length > 0) {
                msgs.push({ ...item, entries });
            }
        }
        if (msgs.length > 0)
            bundle.msgs = msgs;
    }
    if (full.events && full.events.length > 0) {
        const events = [];
        for (const item of full.events) {
            const filteredEvents = item.events.filter((event) => event.sourceUri === sourceUri);
            if (filteredEvents.length > 0) {
                events.push({ ...item, events: filteredEvents });
            }
        }
        if (events.length > 0)
            bundle.events = events;
    }
    if (full.maps && full.maps.length > 0) {
        const maps = [];
        for (const item of full.maps) {
            const entities = item.entities.filter((entity) => entity.sourceUri === sourceUri);
            const regions = item.regions.filter((region) => region.sourceUri === sourceUri);
            if (entities.length > 0 || regions.length > 0) {
                maps.push({ ...item, entities, regions });
            }
        }
        if (maps.length > 0)
            bundle.maps = maps;
    }
    if (full.tae && full.tae.length > 0) {
        const tae = full.tae.filter((item) => item.sourceUri === sourceUri);
        if (tae.length > 0)
            bundle.tae = tae;
    }
    if (full.scripts && full.scripts.length > 0) {
        const scripts = full.scripts.filter((item) => item.sourceUri === sourceUri);
        if (scripts.length > 0)
            bundle.scripts = scripts;
    }
    return bundle;
}
/**
 * Hydrate a cached SymbolBundle into an active WorkspaceIndex.
 */
export function loadSymbolBundleIntoIndex(index, bundle) {
    if (bundle.events) {
        for (const item of bundle.events)
            index.upsertEventExport(item);
    }
    if (bundle.maps) {
        for (const item of bundle.maps)
            index.upsertMapExport(item);
    }
    if (bundle.params) {
        for (const item of bundle.params)
            index.upsertParamExport(item);
    }
    if (bundle.msgs) {
        for (const item of bundle.msgs)
            index.upsertMsgExport(item);
    }
    if (bundle.tae) {
        for (const item of bundle.tae) {
            if (item.readerSchemaRevision === TAE_IDENTITY_PROJECTION_VERSION)
                index.upsertTaeExport(item);
        }
    }
    if (bundle.scripts) {
        for (const item of bundle.scripts)
            index.upsertScriptExport(item);
    }
}
//# sourceMappingURL=semanticFileCache.js.map