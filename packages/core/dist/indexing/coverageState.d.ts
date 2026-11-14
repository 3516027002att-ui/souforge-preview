import type { IndexedFile } from '@soulforge/shared';
/**
 * Coverage is deliberately more precise than a boolean.  A search result is
 * only useful for a negative conclusion when both the source set and the
 * predicate are exhaustive.
 */
export declare const COVERAGE_STATUSES: readonly ["complete", "partial", "not_indexed", "parse_failed", "stale", "source_unavailable"];
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
/** A human-readable scope, kept open so a future resource family need not edit this union. */
export type CoverageScope = string;
export type PredicateKind = 'exact_handle' | 'exact_id' | 'exact_field' | 'complete_range' | 'fuzzy_name' | 'semantic' | 'relationship' | 'unknown';
export type PredicateCompletenessStatus = 'complete' | 'partial' | 'not_applicable' | 'unknown';
export interface PredicateCompleteness {
    kind: PredicateKind;
    status: PredicateCompletenessStatus;
    /** True only when this predicate can enumerate the entire scoped set. */
    exhaustive: boolean;
    predicate: string;
    reason: string;
    missingFields?: string[];
}
export interface CoverageSourceVersion {
    sourceUri: string;
    /** SHA-256 of the packed/outer catalog file. */
    outerFileHash?: string;
    sourceHash?: string;
    sourceRevision?: number | string;
    readerSchemaVersion?: number | string;
    metadataSchemaVersion?: string;
}
export interface CoverageState {
    status: CoverageStatus;
    scope: CoverageScope;
    domain?: string;
    coveredResources: number;
    expectedResources: number | null;
    /** Stable source IDs make a bounded result auditable without exposing bytes. */
    coveredResourceIds: string[];
    expectedResourceIds: string[] | null;
    sourceVersions: CoverageSourceVersion[];
    predicateCompleteness: PredicateCompleteness;
    staleSources: string[];
    diagnostics: string[];
}
/** Compatibility alias used by callers that call a coverage row a record. */
export type CoverageRecord = CoverageState;
export interface CoverageStateInput {
    status?: CoverageStatus;
    scope: CoverageScope;
    domain?: string;
    coveredResources?: number;
    expectedResources?: number | null;
    coveredResourceIds?: readonly string[];
    expectedResourceIds?: readonly string[] | null;
    sourceVersions?: readonly CoverageSourceVersion[];
    predicateCompleteness?: Partial<PredicateCompleteness> & Pick<PredicateCompleteness, 'kind' | 'predicate'>;
    staleSources?: readonly string[];
    diagnostics?: readonly string[];
}
export interface CoverageDerivationInput {
    scope: CoverageScope;
    domain?: string;
    files: readonly Pick<IndexedFile, 'sourceUri' | 'parseStatus' | 'sha256' | 'mtimeMs'>[];
    /** Source URIs for which the requested semantic projection was actually produced. */
    coveredResourceIds?: readonly string[];
    /** Omit when the host cannot know the size of the source set. */
    expectedResourceIds?: readonly string[] | null;
    sourceVersions?: readonly CoverageSourceVersion[];
    staleSources?: readonly string[];
    sourceUnavailable?: boolean;
    predicate?: Partial<PredicateCompleteness> & Pick<PredicateCompleteness, 'kind' | 'predicate'>;
    diagnostics?: readonly string[];
}
export declare const EXHAUSTIVE_PREDICATE_KINDS: readonly PredicateKind[];
export declare function createCoverageState(input: CoverageStateInput): CoverageState;
/**
 * Derive a source-level coverage certificate from the file catalog and the
 * semantic projection that was actually published.
 */
export declare function deriveCoverageState(input: CoverageDerivationInput): CoverageState;
export declare class CoverageStateStore {
    private readonly states;
    set(state: CoverageState): void;
    get(scope?: string, domain?: string): CoverageState | undefined;
    list(): CoverageState[];
    clear(): void;
    /** Mark every state that includes a changed source as stale. */
    markStale(sourceUris: readonly string[], reason?: string): CoverageState[];
}
export declare function coverageKey(scope: CoverageScope, domain?: string): string;
export declare function isCompleteCoverage(state: CoverageState | undefined): boolean;
/**
 * This is the only gate that may produce NOT_FOUND_WITH_COMPLETE_COVERAGE.
 * Fuzzy/semantic retrieval is never exhaustive, even over a complete corpus.
 */
export declare function canConcludeNotFound(state: CoverageState | undefined, predicate?: PredicateCompleteness | undefined): boolean;
export declare function coverageForPredicate(state: CoverageState | undefined, kindOrPredicate: PredicateKind | string): boolean;
export declare function notFoundCode(state: CoverageState | undefined, predicate?: PredicateCompleteness | undefined): 'NOT_FOUND_WITH_COMPLETE_COVERAGE' | 'NOT_FOUND_INCOMPLETE_COVERAGE' | 'FUZZY_QUERY_NO_MATCH';
