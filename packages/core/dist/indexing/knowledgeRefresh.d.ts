import type { IndexedFile, KnowledgeRefreshSummary } from '@soulforge/shared';
import { WorkspaceIndex, type SourceInvalidationResult } from './workspaceIndex.js';
export type KnowledgeRefreshStatus = 'converged' | 'partial' | 'invalidated' | 'failed' | 'preserved';
export interface KnowledgeRefreshResult {
    status: KnowledgeRefreshStatus;
    changedSources: string[];
    invalidated: SourceInvalidationResult;
    semanticState: 'reanalyzed' | 'partial' | 'empty' | 'preserved';
    error?: string;
}
export interface RefreshKnowledgeAfterCommitInput {
    index: WorkspaceIndex;
    beforeFiles: readonly IndexedFile[];
    afterFiles: readonly IndexedFile[];
    requestedSources?: readonly string[];
    /**
     * Rebuild semantic projections from the post-commit bytes.  A callback is
     * deliberately required by production callers: scanning the file catalog
     * alone is not a semantic refresh.
     */
    reanalyze?: (changedSources: readonly string[], signal?: AbortSignal) => Promise<WorkspaceIndex | {
        index: WorkspaceIndex;
        semanticState: 'reanalyzed' | 'partial';
        error?: string;
    }>;
    /** Publish a validated candidate into the live index after freshness checks. */
    publish?: (index: WorkspaceIndex, changedSources: readonly string[], signal?: AbortSignal) => Promise<WorkspaceIndex> | WorkspaceIndex;
    persist?: (index: WorkspaceIndex, changedSources: readonly string[], signal?: AbortSignal) => Promise<void>;
    /** Observe large in-memory publication boundaries without changing refresh authority. */
    onRefreshBoundary?: (stage: 'publish' | 'referenceBuild', phase: 'started' | 'completed' | 'failed') => void;
    /** Abort a bounded post-commit refresh without undoing the committed write. */
    signal?: AbortSignal;
}
export interface RefreshKnowledgeAfterCommitOutput {
    index: WorkspaceIndex;
    result: KnowledgeRefreshResult;
}
export interface PostCommitRefreshBaseline {
    /**
     * The supplied index after the requested source semantics are invalidated.
     * This index is safe to keep live during the asynchronous refresh because
     * it contains no stale projection for those sources.
     */
    index: WorkspaceIndex;
    invalidated: SourceInvalidationResult;
}
/**
 * Invalidate before a potentially slow post-commit scan and reuse that
 * stale-safe active index as the refresh baseline. Callers still build an
 * isolated published index before exposing fresh semantics.
 */
export declare function preparePostCommitRefreshBaseline(index: WorkspaceIndex, requestedSources: readonly string[]): PostCommitRefreshBaseline;
export declare function summarizeKnowledgeRefresh(result: KnowledgeRefreshResult): KnowledgeRefreshSummary;
/**
 * The single post-commit knowledge boundary.
 *
 * The order is intentional and must not be weakened to `scan -> setFiles`:
 * changed sources lose their old semantic projections before a new file
 * catalog or persisted RAG corpus can be considered current.  Reanalysis is
 * allowed to fail, but the returned status then remains `invalidated`/`failed`
 * and the caller must not report semantic convergence.
 */
export declare function refreshKnowledgeAfterCommit(input: RefreshKnowledgeAfterCommitInput): Promise<RefreshKnowledgeAfterCommitOutput>;
export declare function detectChangedSourceUris(before: readonly IndexedFile[], after: readonly IndexedFile[], requestedSources?: readonly string[]): string[];
