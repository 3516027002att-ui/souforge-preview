import type { Diagnostic, RagChunk, RagCorpus, RagHit, RagRetrieveOptions, RagRetrieveResult } from '@soulforge/shared';
import { type ParsedRagQuery } from './queryParse.js';
import { type RagLookupIndex } from './lookupIndex.js';
import { type NormalizedRetrievalScope, type RetrievalScopeInput } from './retrievalScope.js';
export interface RagChunkExclusionMask {
    readonly ids: readonly string[];
    /** Process-local collision-free cache identity; never derived from caller input. */
    readonly cacheKey: string;
    readonly has: (chunkId: string) => boolean;
}
export declare function createRagChunkExclusionMask(ids: readonly string[]): RagChunkExclusionMask;
export interface Sf18RetrieveOptions extends RagRetrieveOptions {
    /** Scope is supplied by the host and may only be narrowed by the caller. */
    scope?: RetrievalScopeInput | NormalizedRetrievalScope;
    workspaceId?: string;
    resourceUris?: readonly string[];
    sourceUris?: readonly string[];
    resourceKinds?: readonly string[];
    relativePaths?: readonly string[];
    revision?: string | number;
    revisions?: readonly (string | number)[];
    game?: string;
    profile?: string;
    language?: string;
    readerSchema?: string;
    metadataSchema?: string;
    embeddingModel?: string;
    embeddingProfile?: string;
    corpusRevision?: string;
    /** Host-computed per-chunk freshness mask for mixed-version corpora. */
    excludeChunkIds?: readonly string[];
    /** Trusted host mask; unlike the array fallback this is immutable and reusable. */
    excludeChunkMask?: RagChunkExclusionMask;
    /** Internal continuation and candidate controls; finalLimit remains strict. */
    cursor?: string;
    candidateLimit?: number;
}
export interface LexicalCandidateSet {
    readonly query: string;
    readonly parsed: ParsedRagQuery;
    readonly corpus: RagCorpus;
    readonly lookup: RagLookupIndex;
    readonly scope: NormalizedRetrievalScope;
    readonly finalLimit: number;
    readonly candidateLimit: number;
    readonly excerptChars: number;
    readonly excludedSourceUris: ReadonlySet<string>;
    readonly excludedChunkIds: RagChunkExclusionMask;
    readonly scopedCandidates: readonly RagChunk[];
    readonly lexicalHits: readonly RagHit[];
    readonly exactHits: readonly RagHit[];
    readonly matched: number;
    readonly diagnostics: readonly Diagnostic[];
}
export type RetrievalPreparation = {
    ok: true;
    value: LexicalCandidateSet;
} | {
    ok: false;
    result: RagRetrieveResult;
};
/**
 * The lexical phase is public so the hybrid path can take candidateLimit
 * lexical ranks instead of accidentally fusing a list already truncated to
 * finalLimit.
 */
export declare function prepareLexicalCandidates(corpus: RagCorpus | null | undefined, query: string, options?: Sf18RetrieveOptions): RetrievalPreparation;
export declare function retrieveEvidence(corpus: RagCorpus | null | undefined, query: string, options?: Sf18RetrieveOptions): RagRetrieveResult;
/** Expand one hop through the cached symbolUri adjacency under the same scope. */
export declare function expandScopedHits(primaryCandidates: readonly RagHit[], lexicalCandidates: readonly RagHit[], lookup: RagLookupIndex, scope: NormalizedRetrievalScope, finalLimit: number, expandReferences: boolean, exactCandidates?: readonly RagHit[], excludedSourceUris?: ReadonlySet<string>, excludedChunkIds?: RagChunkExclusionMask): {
    hits: RagHit[];
    expanded: number;
    outOfScopeEdges: number;
};
export declare function finalizeLexicalCandidates(value: LexicalCandidateSet, expandReferences: boolean): RagRetrieveResult;
export declare function isRagSourceExcluded(sourceUri: string, excludedSourceUris: ReadonlySet<string>): boolean;
