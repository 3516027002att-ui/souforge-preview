import type { NormalizedReferenceQuery } from '@soulforge/shared';
import type { DependencySummary } from '../runtime/resourceVersion.js';
export type ReferenceCursorScope = Pick<NormalizedReferenceQuery, 'uri' | 'target' | 'query' | 'domain' | 'direction' | 'detail' | 'fieldIds' | 'depth' | 'limit' | 'includeHypotheses'>;
export interface ReferenceCursorState {
    workspaceId: string;
    scope: ReferenceCursorScope;
    rootUri: string;
    relationOffset: number;
    /** Reserved for hosts that page source shards separately. */
    sourceOffset?: number;
    /** Opaque enrichment-only scan state; result-page service must reject it. */
    sourceScanState?: unknown;
    /** Complete current bundle/provider fingerprint, not a display hash. */
    sourceVersionKey: string;
    dependencySummary: DependencySummary;
    providerRegistryDigest?: string;
    issuedAt?: number;
    expiresAt?: number;
}
export interface StoredReferenceCursor extends ReferenceCursorState {
    token: string;
    issuedAt: number;
    expiresAt: number;
}
export interface ReferenceCursorStoreOptions {
    /** Maximum live cursors retained by this store. */
    maxEntries?: number;
    /** Idle/lifetime bound. Cursors older than this are discarded. */
    ttlMs?: number;
    /** Clock injection makes expiry behavior deterministic in tests/hosts. */
    now?: () => number;
}
export interface ReferenceCursorStore {
    issue(state: ReferenceCursorState): string;
    /** Alias for hosts that call cursor creation `put`. */
    put(state: ReferenceCursorState): string;
    get(token: string): StoredReferenceCursor | undefined;
    delete(token: string): void;
    clear(): void;
}
declare abstract class BaseReferenceCursorStore implements ReferenceCursorStore {
    protected readonly maxEntries: number;
    protected readonly ttlMs: number;
    protected readonly now: () => number;
    constructor(options?: ReferenceCursorStoreOptions);
    protected abstract readAll(): Map<string, StoredReferenceCursor>;
    protected abstract writeAll(entries: Map<string, StoredReferenceCursor>): void;
    issue(state: ReferenceCursorState): string;
    put(state: ReferenceCursorState): string;
    get(token: string): StoredReferenceCursor | undefined;
    delete(token: string): void;
    clear(): void;
    private prune;
}
export declare class MemoryReferenceCursorStore extends BaseReferenceCursorStore {
    private entries;
    protected readAll(): Map<string, StoredReferenceCursor>;
    protected writeAll(entries: Map<string, StoredReferenceCursor>): void;
}
/** Default store shared by all ReferenceQueryService instances in this host. */
export declare function createReferenceCursorStore(options?: ReferenceCursorStoreOptions): ReferenceCursorStore;
export declare const defaultReferenceCursorStore: ReferenceCursorStore;
export interface ManagedReferenceCursorStoreOptions extends ReferenceCursorStoreOptions {
    fileName?: string;
}
/**
 * JSON-backed store for a managed `.soulforge`/CLI directory.  It refreshes on
 * every operation so a one-shot CLI process can continue a cursor minted by a
 * previous process.  Writes are atomic within the managed directory.
 */
export declare class ManagedReferenceCursorStore extends BaseReferenceCursorStore {
    private readonly filePath;
    constructor(directory: string, options?: ManagedReferenceCursorStoreOptions);
    protected readAll(): Map<string, StoredReferenceCursor>;
    protected writeAll(entries: Map<string, StoredReferenceCursor>): void;
}
export declare function createManagedReferenceCursorStore(directory: string, options?: ManagedReferenceCursorStoreOptions): ReferenceCursorStore;
/** Backward/host-friendly aliases. */
export declare const createMemoryReferenceCursorStore: typeof createReferenceCursorStore;
export type ReferenceCursor = StoredReferenceCursor;
export {};
