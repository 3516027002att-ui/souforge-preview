import type { IndexedFile, ResourceKind, SymbolBundle } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
export interface SemanticFileCacheEntry {
    relativePath: string;
    fileSha256: string;
    resourceKind: ResourceKind;
    payload: SymbolBundle;
    mtimeMs: number;
}
export interface SemanticCacheProvider {
    load: (file: IndexedFile) => Promise<SymbolBundle | null> | SymbolBundle | null;
    save: (file: IndexedFile, bundle: SymbolBundle) => Promise<void> | void;
}
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
export declare function isNativeSemanticBundleCurrent(file: IndexedFile, bundle: SymbolBundle): boolean;
/**
 * Rebind a verified cache payload to the current catalog revision.  The
 * payload is accepted only after isNativeSemanticBundleCurrent compared its
 * outer hash, so this changes freshness metadata, never decoded content or
 * native byte identity.
 */
export declare function rebaseSymbolBundleToFileRevision(file: Pick<IndexedFile, 'mtimeMs'>, bundle: SymbolBundle): SymbolBundle;
/**
 * True when a cached map projection predates nativeOffset identity. Only native part/
 * region symbols are checked; low-confidence `/entity/candidate_N` scans never carried
 * an offset and are not addressable entities.
 */
export declare function hasLegacyMapProjectionWithoutNativeOffset(bundle: SymbolBundle): boolean;
/**
 * Extract symbols belonging to a single file from the populated WorkspaceIndex.
 */
export declare function extractFileSymbolBundle(index: WorkspaceIndex, sourceUri: string): SymbolBundle;
/**
 * Hydrate a cached SymbolBundle into an active WorkspaceIndex.
 */
export declare function loadSymbolBundleIntoIndex(index: WorkspaceIndex, bundle: SymbolBundle): void;
