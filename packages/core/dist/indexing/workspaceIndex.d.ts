import { type TaeActionSearchWindow } from './taeActionSearch.js';
import type { EventExport, EventSymbol, IndexedFile, MapEntitySymbol, MapExport, MapRegionSymbol, MsgExport, ParamExport, ParamRowSymbol, RagChunk, ReferenceEdge, ResourceKind, ScriptExport, SymbolBundle, TaeAnimSymbol, TaeEventSymbol, TaeExport, TextEntrySymbol } from '@soulforge/shared';
import { type ReferenceBuildOptions, type ReferenceBuildResult } from '../references/referenceBuilder.js';
import { type EventEvidenceReport } from '../references/eventEvidence.js';
import { type BinderMembershipCandidate, type BinderMembershipQuery, type BinderMembershipResult } from '../action/binderMembership.js';
import { type CoverageSourceVersion, type CoverageState } from './coverageState.js';
export declare const MSB_READER_SCHEMA_REVISION = 2;
export declare const MSB_READER_SCHEMA_HASH = "msb-schema-rev-2-entityid-verified";
export declare const METADATA_SCHEMA_HASH = "meta-schema-rev-1-sekiro";
export declare function computeMapDerivedKey(input: {
    outerHash: string;
    readerSchemaHash?: string;
    metadataSchemaHash?: string;
}): string;
export interface SearchResourcesOptions {
    query?: string;
    kinds?: readonly ResourceKind[];
    limit?: number;
    /** Continuation token returned by searchResourcesPage. */
    cursor?: string;
    /** Recovery artifacts stay out of the normal resource search by default. */
    sourceFilter?: ResourceSearchSourceFilter;
}
export type ResourceSearchSourceFilter = 'active' | 'all' | 'artifacts';
export interface SearchResourcesPage {
    items: Array<SearchResult<IndexedFile>>;
    /** Agent-facing alias retained alongside the WorkspaceIndex item name. */
    matches: Array<SearchResult<IndexedFile>>;
    total: number;
    totalCount: number;
    offset: number;
    limit: number;
    returned: number;
    returnedCount: number;
    hasMore: boolean;
    truncated: boolean;
    nextCursor?: string;
    nextActions: Array<{
        tool: 'search_resources';
        args: {
            query: string;
            cursor: string;
        };
        reason: string;
    }>;
}
export interface SearchResult<T> {
    item: T;
    score: number;
    highlights: string[];
    /**
     * 这次命中是怎么来的，调用方靠它区分“原文就有”和“折叠后才相等”：
     * - 'exact'       原文规范形里就有这个查询（精确命中，必须保持 exact）
     * - 'cjk-variant' 只有繁→简/NFKC 折叠后才命中（用字不同，但候选是同一个东西）
     * - 'fuzzy'       别名（同义词表）或弱 CJK 部分匹配
     * 空查询不分类：那时每一行都“命中”，把 matchedBy 说成 exact 会撒谎。
     */
    matchedBy?: 'exact' | 'cjk-variant' | 'fuzzy';
}
export interface EventExplanationInput {
    event: EventSymbol;
    report: EventEvidenceReport;
    markdown: string;
    references: ReferenceEdge[];
}
export interface WorkspaceIndexStats {
    files: number;
    filesByKind: Record<ResourceKind, number>;
    events: number;
    mapEntities: number;
    mapRegions: number;
    paramRows: number;
    textEntries: number;
    textEntriesByConfidence: {
        high: number;
        medium: number;
        low: number;
        unknown: number;
    };
    references: number;
}
export interface SourceInvalidationResult {
    sourceUris: string[];
    removed: {
        events: number;
        mapEntities: number;
        mapRegions: number;
        paramRows: number;
        textEntries: number;
        taeExports: number;
    };
    referencesRebuilt: number;
}
/** sourceUri + animId 的严格读取结果；重复 identity 必须显式失败关闭。 */
export type TaeAnimationLookup = {
    status: 'UNIQUE';
    sourceUri: string;
    animId: number;
    animation: TaeAnimSymbol;
    sourceHash?: string;
    sourceRevision?: number;
} | {
    status: 'NOT_FOUND';
    sourceUri: string;
    animId: number;
} | {
    status: 'AMBIGUOUS';
    sourceUri: string;
    animId: number;
    matchCount: number;
};
export interface TaeAnimationIdentitySelector {
    taeEntryIndex?: number;
    taeEntryId?: number;
    taeEntryName?: string;
    taeGroup?: string;
}
export type ParamSemanticState = 'uninitialized' | 'scanning' | 'warming_up' | 'ready' | 'empty' | 'failed';
export interface NativeProjectionAcceptance {
    accepted: boolean;
    sourceUri: string;
    code?: 'NATIVE_PROJECTION_STALE' | 'NATIVE_PROJECTION_VERSION_CONFLICT';
    reason?: string;
}
export declare class WorkspaceIndex {
    readonly workspaceId: string;
    private filesByUri;
    private eventExports;
    private mapExports;
    private paramExports;
    private msgExports;
    private taeExports;
    /** On-demand/native LUABND projections used by script reference edges. */
    private scriptExports;
    private references;
    private referencesDirty;
    private lastReferenceBuildResult;
    /**
     * Builds requested with explicit options (for example the EMEVD registry) are not the canonical
     * graph, so they used to be thrown away after every call and rebuilt on the next one — a caller
     * that reads references repeatedly paid the full graph build every time. Cache them per option set
     * and drop the cache wherever references are marked dirty.
     */
    private referenceBuildCache;
    /** Bumped by markReferencesDirty; cache entries from an older generation are stale. */
    private referenceBuildGeneration;
    private actionBinderMembershipCandidates;
    private actionBinderMembershipReady;
    /** Families whose foreground membership projection is complete. */
    private actionBinderMembershipReadyFamilies;
    private paramSemanticState;
    private readonly coverageStore;
    /** Changed sources remain stale until a current-version projection is published. */
    private readonly staleSources;
    /** Sources with useful decoded leaves but incomplete native coverage. */
    private readonly partialSources;
    /** Highest accepted semantic version per physical source/child identity. */
    private readonly latestProjectionVersions;
    /** Monotonic identity epoch used by host-side RAG freshness masks. */
    private nativeVersionEpoch;
    /** Cached source URI projections; semantic arrays replace on mutation. */
    private readonly semanticSourceUriCache;
    constructor(workspaceId: string);
    /**
     * Clone the complete semantic snapshot for an isolated refresh candidate.
     *
     * Native post-commit refreshes may spend minutes outside the event loop
     * while reading Bridge data and persisting RAG deltas.  A candidate must not
     * share the live index's mutable arrays or scoped ACTION membership: a late
     * or failed refresh must leave the live snapshot at its already-invalidated
     * state.  Keep this copy operation here, where all private projection state
     * is available, instead of reconstructing a partial bundle at each caller.
     */
    cloneForRefresh(): WorkspaceIndex;
    /**
     * Fork the mutable containers for a source refresh while structurally
     * sharing unchanged native projection trees. WorkspaceIndex updates use
     * copy-on-write top-level exports; callers must not mutate nested objects
     * returned by `toSymbolBundle()` directly.
     *
     * The regular `cloneForRefresh()` remains deeply isolated for native readers
     * that may mutate imported input. This variant is for a validated refresh
     * candidate whose unchanged projections have already passed provenance
     * checks and are immutable for the lifetime of the fork.
     */
    cloneForRefreshShared(): WorkspaceIndex;
    setFiles(files: readonly IndexedFile[]): void;
    /**
     * Version of the native source identity snapshot used by host-side RAG
     * freshness masks.  It changes when the file catalog, invalidation state, or
     * an accepted native projection changes; callers can therefore cache a mask
     * per (WorkspaceIndex, RagCorpus, epoch) instead of rescanning all chunks on
     * every query.
     */
    getNativeVersionEpoch(): number;
    /**
     * Return semantic/file chunks that cannot be proven to describe the current
     * native source identity.  This is deliberately chunk-level: a partial read
     * may publish a fresh row while durable storage still contains old rows from
     * the same source.  Fresh rows survive; only the old/missing-provenance rows
     * are excluded.
     */
    getRagStaleChunkIds(chunks: readonly RagChunk[]): string[];
    /**
     * Install the complete ACTION binder membership projection produced by the
     * workspace indexer. Playback may query this projection, but must not scan
     * sibling ANIBND files or parse containers on demand.
     */
    setActionBinderMembership(candidates: readonly BinderMembershipCandidate[], characterFamilies?: readonly string[]): void;
    /**
     * Install a complete projection for one or more character families without
     * discarding another family that is already available to the foreground.
     * The global-ready bit deliberately stays false until the full indexer
     * publishes every discovered family.
     */
    mergeActionBinderMembership(characterFamilies: readonly string[], candidates: readonly BinderMembershipCandidate[]): void;
    /** Mark the global projection stale without dropping valid scoped families. */
    markActionBinderMembershipGlobalNotReady(): void;
    /** Drop only the requested scoped projection and fail closed for it. */
    clearActionBinderMembershipFamilies(characterFamilies: readonly string[]): void;
    /** Drop the projection when its source catalog/session is no longer valid. */
    clearActionBinderMembership(): void;
    isActionBinderMembershipReady(): boolean;
    isActionBinderMembershipReadyFor(characterFamily: string): boolean;
    getParamSemanticState(): ParamSemanticState;
    setParamSemanticState(state: ParamSemanticState): void;
    /** Return the workspace-wide coverage certificate. */
    getCoverageState(scope?: string, domain?: string): CoverageState;
    /** Alias used by discovery consumers that name a certificate a coverage record. */
    getCoverage(domain?: string, scope?: string): CoverageState;
    getCoverageSnapshot(): CoverageState[];
    setCoverageState(state: CoverageState): void;
    markCoverageStale(sourceUris: readonly string[], reason?: string): CoverageState[];
    markCoveragePartial(sourceUris: readonly string[]): CoverageState[];
    /**
     * Gate semantic projection publication.  An async native read may finish
     * after a newer read or a commit; an older projection must never replace the
     * newer one.  Missing provenance remains usable for synthetic/catalog-only
     * callers, but concrete conflicting versions fail closed.
     */
    acceptNativeProjection(sourceUri: string, version?: Omit<CoverageSourceVersion, 'sourceUri'>, projectionKey?: string): NativeProjectionAcceptance;
    isNativeProjectionCurrent(sourceUri: string, version?: Omit<CoverageSourceVersion, 'sourceUri'>): boolean;
    lookupActionBinderMembership(query: BinderMembershipQuery): BinderMembershipResult;
    private refreshActionBinderSourceRevision;
    /**
     * Remove semantic projections whose provenance points at changed sources.
     * Replacing the file catalog alone proves only that bytes changed; it does
     * not prove that old decoded symbols still describe the new bytes.
     * A synchronous projection replacement may defer the intermediate graph;
     * that caller must rebuild before returning. Reference queries do not
     * rebuild lazily, and the default still rebuilds synchronously here.
     */
    invalidateChangedSources(sourceUris: readonly string[], options?: {
        rebuildReferences?: boolean;
    }): SourceInvalidationResult;
    private deleteProjectionVersionsForSource;
    invalidateSource(sourceUri: string): SourceInvalidationResult;
    upsertEventExport(value: EventExport): boolean;
    upsertMapExport(value: MapExport): boolean;
    /**
     * Idempotent migration of MSB reader schema (SF-02: revision 1 -> revision 2).
     * Stale map EntityID projections from schema revision < 2 are evicted/invalidated,
     * and dependent references are rebuilt. Returns the number of invalidated map sources.
     */
    migrateMsbReaderSchema(targetRevision?: number): {
        migratedSources: string[];
        staleMapExportsRemoved: number;
        referencesRebuilt: number;
    };
    upsertParamExport(value: ParamExport): boolean;
    /** Merge a partial live PARAM read without erasing rows indexed earlier. Returns false for a no-op or rejected stale projection. */
    mergeParamRows(value: ParamExport): boolean;
    upsertMsgExport(value: MsgExport): boolean;
    /** Merge a partial live FMG read without erasing entries indexed earlier. */
    mergeMsgEntries(value: MsgExport): void;
    /** 照 upsertMapExport 抄：TAE 一份 anibnd 一个 TaeExport，按 sourceUri 替换。 */
    upsertTaeExport(value: TaeExport): boolean;
    /** Merge bounded reads from the same snapshot without dropping unread siblings. */
    mergeTaeEvents(value: TaeExport): boolean;
    /**
     * Publish a bounded LUABND catalog or a native child read into the shared
     * semantic snapshot. A list operation may only provide catalog-only or
     * bytecode children; those remain visible for containment, while the source
     * is marked partial until decodable source/IR coverage is available.
     */
    upsertScriptExport(value: ScriptExport): boolean;
    /**
     * 按精确 sourceUri + TAE entry selector + animId 读取一个 TAE animation identity。
     *
     * sourceUri 不做 alias/fuzzy 匹配，animId 也不跨来源合并；同一来源出现
     * 多个相同 animId 时，未带 selector 返回 AMBIGUOUS，调用方不得取首项继续解析。
     */
    lookupTaeAnimation(sourceUri: string, animId: number, selector?: TaeAnimationIdentitySelector): TaeAnimationLookup;
    rebuildReferences(options?: ReferenceBuildOptions): ReferenceBuildResult;
    toSymbolBundle(): SymbolBundle;
    getStats(): WorkspaceIndexStats;
    /** Stable cache key for one reference build option set (registry identity, hypotheses, ambiguity cap). */
    private static referenceOptionsKey;
    /**
     * Backwards-compatible bounded resource search.  Callers that need to
     * inspect every match must use searchResourcesPage and follow its opaque
     * cursor; this method deliberately retains the historical array shape.
     */
    searchResources(options: SearchResourcesOptions): Array<SearchResult<IndexedFile>>;
    /**
     * Search the catalog with a stable, query-bound continuation cursor.
     * Recovery artifacts remain in the catalog for restore/history consumers,
     * but are excluded from the default active source view.  `sourceFilter`
     * makes that boundary explicit without deleting or hiding the files from
     * the workspace index itself.
     */
    searchResourcesPage(options: SearchResourcesOptions): SearchResourcesPage;
    private searchResourceResults;
    searchEvents(query: string, limit?: number): Array<SearchResult<EventSymbol>>;
    /**
     * Return a deterministic event-search window over the complete indexed
     * candidate set. The old searchEvents method applied the limit before the
     * host could mint a continuation cursor, so a truncated Agent result had no
     * safe way to request the next candidates.
     */
    searchEventsPage(query: string, offset?: number, limit?: number): {
        items: Array<SearchResult<EventSymbol>>;
        total: number;
        offset: number;
        returned: number;
        hasMore: boolean;
    };
    /** Exact event lookup used after the caller has resolved a source file. */
    lookupEvents(eventId: number, sourceUri?: string): EventSymbol[];
    searchMapEntities(query: string, limit?: number): Array<SearchResult<MapEntitySymbol | MapRegionSymbol>>;
    /**
     * 一个地图实体的唯一地址。重名 part/region 用 nativeOffset 消歧，格式化函数与
     * read_msb_parts 完全同一份（@soulforge/shared 的 formatMapAddress）。
     *
     * 索引记录在 ingest 时已带 address；这里对旧缓存兜底：按同一 source+map 的完整
     * 实体表重新判定重名，绝不把重名实体输出成同一个 `<mapId>#<name>`。
     */
    mapEntityAddress(symbol: MapEntitySymbol | MapRegionSymbol): string;
    searchParamRows(query: string, limit?: number, paramNames?: readonly string[]): Array<SearchResult<ParamRowSymbol>>;
    searchTextEntries(query: string, limit?: number): Array<SearchResult<TextEntrySymbol>>;
    /**
     * 零命中时的「用字可能不同」候选（文本层）。
     *
     * 只在 0 命中时调用。比的是等长、单字替换的条目，折叠后仍然不同才算“不同”——所以它专治
     * 繁简表救不了的那类：数据写「锈丸」、用户写「绣丸」，两个字互不为繁简，但确实是同一个东西。
     * 返回的是**数据原文**，调用方据此自己决定要不要换个字再搜。
     */
    suggestVariantTextEntries(query: string, limit?: number): TextEntrySymbol[];
    /** 零命中时的「用字可能不同」候选（参数行名层），规则同 `suggestVariantTextEntries`。 */
    suggestVariantParamRows(query: string, limit?: number, paramNames?: readonly string[]): ParamRowSymbol[];
    /** 问题 6-C/D：按地址（action://c1050/A0200/e0 / c1050#A0200.e0）、类型名与字段值搜 TAE 词条。 */
    searchTaeEvents(query: string, limit?: number): Array<SearchResult<TaeEventSymbol>>;
    /** Compatibility projection; the search provider always owns bounded pages. */
    searchTaeActionGroups(query: string, limit?: number): {
        matchedEventIndicesTruncated: boolean;
        item: {
            eventProjection?: "compact";
            events: (import("../editing/taeCompactEvent.js").TaeCompactEvent | TaeEventSymbol)[];
            eventPageSize: number;
            eventsFiltered?: true;
            sourceUri: string;
            chrId: string;
            address: string;
            sourceHash: string | undefined;
            sourceRevision: number | undefined;
            readerSchemaRevision: number | undefined;
            indexedEventsComplete: boolean;
            eventsComplete: boolean;
            eventsTruncated: boolean;
            eventCount?: number;
            animId: number;
            motionAnimId?: number;
            taeEntryIndex?: number;
            taeEntryId?: number;
            taeEntryName?: string;
            taeGroup?: string;
            code: string;
            hkxName?: string;
        };
        filteredEventCount?: number;
        score: number;
        matchedEventIndices: number[];
        matchedEventCount: number;
    }[];
    searchTaeActionGroupsPage(query: string, window?: TaeActionSearchWindow): {
        continuation?: string;
        filteredActions?: number;
        matches: {
            matchedEventIndicesTruncated: boolean;
            item: {
                eventProjection?: "compact";
                events: (import("../editing/taeCompactEvent.js").TaeCompactEvent | TaeEventSymbol)[];
                eventPageSize: number;
                eventsFiltered?: true;
                sourceUri: string;
                chrId: string;
                address: string;
                sourceHash: string | undefined;
                sourceRevision: number | undefined;
                readerSchemaRevision: number | undefined;
                indexedEventsComplete: boolean;
                eventsComplete: boolean;
                eventsTruncated: boolean;
                eventCount?: number;
                animId: number;
                motionAnimId?: number;
                taeEntryIndex?: number;
                taeEntryId?: number;
                taeEntryName?: string;
                taeGroup?: string;
                code: string;
                hkxName?: string;
            };
            filteredEventCount?: number;
            score: number;
            matchedEventIndices: number[];
            matchedEventCount: number;
        }[];
        total: number;
        snapshotId: string;
        retainedCandidates: number;
    };
    /** The same ranking over exports the caller supplies, such as a native scan of one file that is not indexed (#52). */
    searchTaeActionGroupsPageIn(exports: readonly TaeExport[], query: string, window?: TaeActionSearchWindow): {
        continuation?: string;
        filteredActions?: number;
        matches: {
            matchedEventIndicesTruncated: boolean;
            item: {
                eventProjection?: "compact";
                events: (import("../editing/taeCompactEvent.js").TaeCompactEvent | TaeEventSymbol)[];
                eventPageSize: number;
                eventsFiltered?: true;
                sourceUri: string;
                chrId: string;
                address: string;
                sourceHash: string | undefined;
                sourceRevision: number | undefined;
                readerSchemaRevision: number | undefined;
                indexedEventsComplete: boolean;
                eventsComplete: boolean;
                eventsTruncated: boolean;
                eventCount?: number;
                animId: number;
                motionAnimId?: number;
                taeEntryIndex?: number;
                taeEntryId?: number;
                taeEntryName?: string;
                taeGroup?: string;
                code: string;
                hkxName?: string;
            };
            filteredEventCount?: number;
            score: number;
            matchedEventIndices: number[];
            matchedEventCount: number;
        }[];
        total: number;
        snapshotId: string;
        retainedCandidates: number;
    };
    lookupTextEntries(textId: number, category?: string): TextEntrySymbol[];
    lookupTextEntry(textId: number, category?: string): TextEntrySymbol | undefined;
    private isActiveSemanticSourceUri;
    private activeEventExportsForSearch;
    private activeMsgExportsForSearch;
    getFiles(): IndexedFile[];
    getFile(uri: string): IndexedFile | undefined;
    /**
     * Return stale source identities plus every indexed alias for the same
     * physical file.  RAG retrieval uses this small set to exclude the old
     * durable corpus while a post-commit semantic refresh is in flight; it does
     * not rebuild or clear the durable corpus.
     */
    getStaleSourceUris(): string[];
    listReferences(): ReferenceEdge[];
    getEvent(uri: string): EventSymbol | undefined;
    findReferences(uri: string, direction?: 'from' | 'to' | 'both'): ReferenceEdge[];
    buildEventExplanationInput(uri: string): EventExplanationInput | null;
    private canonicalSourceUri;
    private recomputeCoverageStates;
    private invalidateSemanticSourceUriCache;
    private markReferencesDirty;
    private semanticSourceUris;
}
