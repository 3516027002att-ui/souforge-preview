import type { Diagnostic, RagChunk, RagChunkFamily, RagCorpus, ReferenceEdge } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
/**
 * Controls whether corpus construction also materializes the in-memory
 * inverted lookup maps.  The default stays eager for every existing caller;
 * explicitly deferred corpora must be prepared at an asynchronous host
 * boundary before retrieval, avoiding duplicate full indexes during refresh.
 */
export type RagCorpusLookupIndexMode = 'eager' | 'deferred';
export interface RagCorpusBuildOptions {
    lookupIndex?: RagCorpusLookupIndexMode;
    /**
     * Skip the full reference graph when assembling a source/symbol-scoped
     * candidate whose caller will supply the authoritative final references.
     */
    includeReferences?: boolean;
    /**
     * Optional host-controlled projection.  File chunks remain included unless
     * the caller explicitly omits them; they carry the source identity needed
     * to prove persisted semantic chunks are still current.
     */
    families?: readonly RagChunkFamily[];
}
export declare function buildRagCorpus(index: WorkspaceIndex, now?: string, diagnostics?: readonly Diagnostic[], sourceUris?: readonly string[], symbolUris?: readonly string[], options?: RagCorpusBuildOptions): RagCorpus;
export declare function ragPersistenceChunks(corpus: RagCorpus): readonly RagChunk[];
export declare function createRagCorpus(input: {
    workspaceId: string;
    builtAt: string;
    chunks: readonly RagChunk[];
    references?: readonly ReferenceEdge[];
    diagnostics?: readonly Diagnostic[];
    /** Defaults to eager; deferred callers must attach the lookup at an async retrieval boundary. */
    lookupIndex?: RagCorpusLookupIndexMode;
}): RagCorpus;
export declare function mergeCatalogAndPersisted(catalog: RagCorpus, persisted: RagCorpus, options?: {
    lookupIndex?: RagCorpusLookupIndexMode;
}): RagCorpus;
export declare function emptyFamilyCounts(): Record<RagChunkFamily, number>;
