/** T03 共享原生快照：版本化不可变快照、同源读取合并、容量与取消管理。 */
export interface SnapshotKey {
    outerSource: string;
    version: string;
    readerKind: string;
    schema: string;
    shape: string;
}
export interface SnapshotEntry<T = unknown> {
    key: string;
    data: T;
    bytes: number;
    pinned: number;
    generation: number;
}
export interface SnapshotCacheOptions {
    maxBytes?: number;
    maxEntries?: number;
}
export declare class NativeSnapshotCache {
    private entries;
    private inflight;
    private lru;
    private bytes;
    private disposed;
    /** 每 key 单调世代：失效即递增，晚到的旧结果凭此识别并丢弃。 */
    private epochs;
    private readonly maxBytes;
    private readonly maxEntries;
    constructor(options?: SnapshotCacheOptions);
    getExact<T>(key: SnapshotKey): T | undefined;
    readThrough<T>(key: SnapshotKey, waiterId: string, load: () => Promise<{
        data: T;
        bytes: number;
    }>, signal?: AbortSignal): Promise<T>;
    cancelWaiter(name: string, waiterId: string): void;
    pin(name: string): void;
    unpin(name: string): void;
    invalidateOuter(outerSource: string): void;
    private store;
    private touch;
    dispose(): void;
    get isDisposed(): boolean;
}
/**
 * Shared native snapshot cache (执行指令 T03, §8.2).
 *
 * Organized by "outer physical source + version + reader/schema + read shape".
 * One outer BND snapshot may own several child snapshots; one full EMEVD
 * document may serve several event windows. Completeness is written into the
 * entry key, so an `outline` snapshot can never satisfy a `full-document`
 * request (V08).
 *
 * Responsibilities proven by runReferenceOptimizationPerformanceSmoke:
 *   - single-flight: concurrent identical cold reads share one underlying
 *     parse (V05); a failed/cancelled read never masquerades as a hit.
 *   - hot reads on the same version add zero incremental parses (§8.2).
 *   - waiter cancellation: cancelling one waiter rejects only that waiter;
 *     the shared parse still completes and publishes (V06/V07).
 *   - invalidation drops every child/shape entry for an outer source (V01).
 *   - bypass reads re-parse and republish without merging with stale cache.
 *
 * The cache stores immutable snapshots only; returned values are deep-frozen
 * so a caller cannot mutate cached arrays, Maps or native documents. Byte and
 * entry budgets are constructor-injected engineering defaults (128 MiB / 256
 * entries), never model-authored.
 */
export interface SnapshotCacheKey {
    /** Canonical outer physical source identity (never a display label). */
    sourceUri: string;
    /** Read shape: 'full-document' | 'outline' | 'rows' | … ; part of the key. */
    shape: string;
    /** Version tag (outer hash / dependency summary) distinguishing snapshots. */
    version: string;
}
export interface SnapshotReadOptions {
    /**
     * Bypass the cache for a pre/post-write verification read: always re-parse,
     * never merge with an older in-flight promise, then republish a fresh
     * snapshot. Does not skip writer validation (that stays in the write path).
     */
    bypass?: boolean;
    /** Cancelling this signal rejects only the current waiter (V06/V07). */
    signal?: AbortSignal;
}
/** Minimal native port the cache drives; counters live at this boundary. */
export interface SnapshotBackend {
    parse(sourceUri: string): unknown;
    inventory?(sourceUri: string): unknown;
}
export interface SnapshotCacheStats {
    coalescedWaiters: number;
    hits: number;
    misses: number;
}
export interface NativeSnapshotCacheOptions {
    backend: SnapshotBackend;
    /** Byte budget (approximate, via serialized size). Default 128 MiB. */
    maxBytes?: number;
    /** Entry-count budget. Default 256. */
    maxEntries?: number;
}
export interface ManagedNativeSnapshotCache {
    read(key: SnapshotCacheKey, options?: SnapshotReadOptions): Promise<unknown>;
    /** Drop every shape/version entry for one outer source (outer-file change). */
    invalidate(sourceUri: string): void;
    stats(): SnapshotCacheStats;
    dispose(): Promise<void>;
}
export declare class SnapshotCancelledError extends Error {
    readonly code = "SNAPSHOT_READ_CANCELLED";
    constructor(sourceUri: string);
}
export declare function createNativeSnapshotCache(options: NativeSnapshotCacheOptions): ManagedNativeSnapshotCache;
