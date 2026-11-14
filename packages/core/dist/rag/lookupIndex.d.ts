/**
 * In-memory inverted index for workspace RAG.
 *
 * retrieveEvidence used to score every chunk. After analyze, a real Sekiro
 * workspace is tens of thousands of param/text/event rows — that linear scan
 * is the slow path. FTS tables exist in SQLite but the Agent tool never
 * called them. This index is built once with the corpus and used to gather
 * a candidate set before the existing scorer runs.
 */
import type { RagChunk, RagChunkFamily, RagCorpus, ReferenceEdge } from '@soulforge/shared';
import { type NormalizedRetrievalScope } from './retrievalScope.js';
export type RagAdjacentReference = ReferenceEdge & {
    /** URI at the other end of the undirected reference edge. */
    otherUri: string;
    /** Reference-algorithm compatible alias. */
    other: string;
};
export interface RagLookupIndex {
    byNumericId: Map<number, number[]>;
    byNumericPrefix: Map<string, number[]>;
    byToken: Map<string, number[]>;
    byUri: Map<string, number[]>;
    bySymbolUri: Map<string, RagChunk>;
    bySymbolUriAll: Map<string, RagChunk[]>;
    adjacency: Map<string, RagAdjacentReference[]>;
    adjacencyEdges?: ReferenceEdge[];
    referenceKeyCounts?: Map<string, {
        fromUri: string;
        toUri: string;
        count: number;
    }>;
    referenceSignature: string;
    chunkSignature: string;
}
/** Large native workspace corpora can need several minutes for the yielded lookup projection. */
export declare const DEFAULT_RAG_LOOKUP_BUILD_TIMEOUT_MS = 600000;
export declare function attachLookupIndex(corpus: RagCorpus): RagLookupIndex;
export interface RagLookupBuildOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    batchSize?: number;
    maxSliceMs?: number;
    onProgress?: (progress: {
        completed: number;
        total: number;
    }) => void;
    /** Host/test scheduler; must yield an event-loop turn, not just a microtask. */
    yieldControl?: () => Promise<void>;
}
/** Prepare before publication: a cancelled or timed-out partial index is never attached. */
export declare function attachLookupIndexAsync(corpus: RagCorpus, options?: RagLookupBuildOptions): Promise<RagLookupIndex>;
export declare function getLookupIndex(corpus: RagCorpus): RagLookupIndex | undefined;
export declare function ensureLookupIndex(corpus: RagCorpus): RagLookupIndex;
export declare function buildLookupIndex(chunks: readonly RagChunk[], references?: readonly ReferenceEdge[]): RagLookupIndex;
export declare function collectIndexedCandidates(chunks: readonly RagChunk[], index: RagLookupIndex, query: {
    numericIds: readonly number[];
    terms: readonly string[];
    phrases: readonly string[];
    uris: readonly string[];
}, filter: ReadonlySet<RagChunkFamily> | NormalizedRetrievalScope | null): RagChunk[];
export declare function buildReferenceAdjacency(edges: readonly ReferenceEdge[]): Map<string, RagAdjacentReference[]>;
/**
 * Refresh only adjacency buckets touched by changed edges.  The inverted
 * token/numeric maps remain valid during an incremental reference refresh.
 */
export declare function refreshReferenceAdjacency(index: RagLookupIndex, edges: readonly ReferenceEdge[]): void;
