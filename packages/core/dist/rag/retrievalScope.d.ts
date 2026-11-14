import type { RagChunk, RagChunkFamily, RagCorpus } from '@soulforge/shared';
export type RetrievalVersion = string | number;
/**
 * The host supplies the workspace identity and the outer authorization.  A
 * model may narrow these values, but it cannot use this object to widen them.
 * The loose string arrays are intentional: this is also the boundary for
 * untrusted tool input, and normalizeRetrievalScope validates them at runtime.
 */
export interface RetrievalScopeInput {
    workspaceId?: string;
    families?: readonly string[];
    resourceUris?: readonly string[];
    sourceUris?: readonly string[];
    resourceKinds?: readonly string[];
    resourceKind?: string;
    relativePaths?: readonly string[];
    sourceUriPrefixes?: readonly string[];
    resourceUriPrefixes?: readonly string[];
    game?: string;
    profile?: string;
    language?: string;
    revision?: RetrievalVersion;
    revisions?: readonly RetrievalVersion[];
    stalePolicy?: 'exclude' | 'allow' | string;
    allowStale?: boolean;
    readerSchema?: string;
    metadataSchema?: string;
    embeddingModel?: string;
    embeddingProfile?: string;
    corpusRevision?: string;
}
export interface RetrievalScopeAuthorization {
    workspaceId: string;
    families?: readonly RagChunkFamily[];
    resourceUris?: readonly string[];
    resourceKinds?: readonly string[];
    relativePaths?: readonly string[];
    sourceUriPrefixes?: readonly string[];
    game?: string;
    profile?: string;
    language?: string;
    revision?: RetrievalVersion;
    revisions?: readonly RetrievalVersion[];
}
export interface NormalizedRetrievalScope {
    readonly workspaceId: string;
    readonly families: ReadonlySet<RagChunkFamily>;
    readonly resourceUris?: ReadonlySet<string>;
    readonly resourceKinds?: ReadonlySet<string>;
    readonly relativePaths?: ReadonlySet<string>;
    readonly sourceUriPrefixes?: readonly string[];
    readonly game?: string;
    readonly profile?: string;
    readonly language?: string;
    readonly revision?: RetrievalVersion;
    readonly revisions?: ReadonlySet<RetrievalVersion>;
    /** Stale chunks are always rejected; this is deliberately not caller-overridable. */
    readonly stalePolicy: 'exclude';
    readonly readerSchema?: string;
    readonly metadataSchema?: string;
    readonly embeddingModel?: string;
    readonly embeddingProfile?: string;
    readonly corpusRevision?: string;
    readonly key: string;
}
export declare class RetrievalScopeError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Normalize the one scope used by lexical lookup, vector lookup, exact
 * matching, and reference expansion.  The array overload mirrors the small
 * reference algorithm and is useful for direct algorithm tests.
 */
export declare function normalizeRetrievalScope(input: RetrievalScopeInput | undefined, authorization?: RetrievalScopeAuthorization | readonly RagChunkFamily[], expectedWorkspaceId?: string): NormalizedRetrievalScope;
/** Short alias retained for callers that mirror the reference algorithm. */
export declare const normalizeScope: typeof normalizeRetrievalScope;
/** The one hard predicate shared by every retrieval branch. */
export declare function isChunkEligible(chunk: RagChunk, scope: NormalizedRetrievalScope): boolean;
/** Short alias retained for direct algorithm tests. */
export declare const eligible: typeof isChunkEligible;
export declare function chunkRevisionOf(chunk: RagChunk): RetrievalVersion | undefined;
export declare function retrievalCandidateLimit(finalLimit: number): number;
export declare function corpusRevision(corpus: RagCorpus): string;
interface ValidatedLookupIdentity {
    readonly chunkSignature: string;
    readonly referenceSignature: string;
}
/**
 * Return a canonical revision after the caller has completed ensureLookupIndex
 * validation.  The same helper also warms the revision cache during async index
 * publication, so the first retrieval does not pay the canonical sort cost.
 */
export declare function corpusRevisionForValidatedLookup(corpus: RagCorpus, lookup: ValidatedLookupIdentity): string;
export interface RetrievalCacheKeyInput {
    query: string;
    scope: NormalizedRetrievalScope;
    corpusRevision: string;
    readerSchema?: string;
    metadataSchema?: string;
    embeddingModel?: string;
    embeddingProfile?: string;
    limit: number;
    candidateLimit: number;
    excerptChars: number;
    expandReferences: boolean;
    excludeSourceUris?: readonly string[];
    excludeChunkIds?: readonly string[];
    excludeChunkMaskKey?: string;
    mode?: 'lexical' | 'hybrid';
}
export declare function retrievalCacheKey(input: RetrievalCacheKeyInput): string;
export declare function getRetrievalCache<T>(key: string): T | undefined;
export declare function setRetrievalCache(key: string, workspaceId: string, result: unknown): void;
/** Source or schema refreshes invalidate the whole workspace query cache. */
export declare function invalidateRetrievalCache(workspaceId: string): void;
export declare function clearRetrievalCache(): void;
export {};
