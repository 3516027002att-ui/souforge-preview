/**
 * Hybrid evidence retrieval. Lexical and vector candidates are both ranked
 * to candidateLimit, filtered by one normalized scope, then fused with RRF.
 */
import type { RagChunk, RagCorpus, RagRetrieveResult } from '@soulforge/shared';
import { type NormalizedRetrievalScope } from './retrievalScope.js';
import { type Sf18RetrieveOptions } from './retrieve.js';
export interface HybridVectorSource {
    /** chunkId -> corpus embedding（必须与 queryVector 同一模型）。 */
    vectors: ReadonlyMap<string, ArrayLike<number>>;
    queryVector: ArrayLike<number>;
    /** Optional provenance supplied by the embedding store. */
    model?: string;
    embeddingModel?: string;
    corpusRevision?: string;
    embeddingProfile?: string;
    normalizationProfile?: string;
    dim?: number;
    dimension?: number;
}
export type HybridRetrieveOptions = Sf18RetrieveOptions & {
    vectors?: HybridVectorSource;
};
/** RRF 常量：经典 60。 */
export declare const RRF_K = 60;
export declare function retrieveEvidenceHybrid(corpus: RagCorpus | null | undefined, query: string, options?: HybridRetrieveOptions): RagRetrieveResult;
/** Reference-compatible RRF helper with pre-rank filtering and deduplication. */
export declare function fuseRrf(chunks: readonly RagChunk[], lexicalIds: readonly string[], vectorIds: readonly string[], scope: NormalizedRetrievalScope, limit: number, exactIds?: readonly string[], excludedChunkIds?: ReadonlySet<string>): RagChunk[];
