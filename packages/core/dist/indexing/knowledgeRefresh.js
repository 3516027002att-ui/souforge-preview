import { WorkspaceIndex } from './workspaceIndex.js';
/**
 * Invalidate before a potentially slow post-commit scan and reuse that
 * stale-safe active index as the refresh baseline. Callers still build an
 * isolated published index before exposing fresh semantics.
 */
export function preparePostCommitRefreshBaseline(index, requestedSources) {
    const uniqueSources = [...new Set(requestedSources.filter((sourceUri) => sourceUri.trim().length > 0))];
    const alreadyStale = new Set(index.getStaleSourceUris().map(normalizeSourceToken));
    const sourcesToInvalidate = uniqueSources.filter((sourceUri) => !alreadyStale.has(normalizeSourceToken(sourceUri)));
    const newlyInvalidated = index.invalidateChangedSources(sourcesToInvalidate);
    // invalidateChangedSources rebuilds references when it actually removes
    // semantics. Preserve the caller's full requested identity set while
    // avoiding another whole-graph rebuild for sources already invalidated by
    // an earlier stage of this same post-commit refresh.
    const invalidated = sourcesToInvalidate.length === uniqueSources.length
        ? newlyInvalidated
        : { ...newlyInvalidated, sourceUris: uniqueSources };
    return { index, invalidated };
}
export function summarizeKnowledgeRefresh(result) {
    const removed = result.invalidated.removed;
    return {
        status: result.status,
        semanticState: result.semanticState,
        changedSourceCount: result.changedSources.length,
        invalidatedSourceCount: result.invalidated.sourceUris.length,
        removedSemanticCount: removed.events
            + removed.mapEntities
            + removed.mapRegions
            + removed.paramRows
            + removed.textEntries
            + removed.taeExports,
        ...(result.error ? { error: result.error } : {})
    };
}
/**
 * The single post-commit knowledge boundary.
 *
 * The order is intentional and must not be weakened to `scan -> setFiles`:
 * changed sources lose their old semantic projections before a new file
 * catalog or persisted RAG corpus can be considered current.  Reanalysis is
 * allowed to fail, but the returned status then remains `invalidated`/`failed`
 * and the caller must not report semantic convergence.
 */
export async function refreshKnowledgeAfterCommit(input) {
    const changedSources = detectChangedSourceUris(input.beforeFiles, input.afterFiles, input.requestedSources ?? []);
    throwIfRefreshAborted(input.signal);
    const invalidated = preparePostCommitRefreshBaseline(input.index, changedSources).invalidated;
    input.index.setFiles(input.afterFiles);
    if (changedSources.length === 0) {
        await input.persist?.(input.index, changedSources, input.signal);
        return {
            index: input.index,
            result: {
                status: 'preserved',
                changedSources,
                invalidated,
                semanticState: 'preserved'
            }
        };
    }
    if (!input.reanalyze) {
        await input.persist?.(input.index, changedSources, input.signal);
        return {
            index: input.index,
            result: {
                status: 'invalidated',
                changedSources,
                invalidated,
                semanticState: 'empty'
            }
        };
    }
    try {
        throwIfRefreshAborted(input.signal);
        const reanalyzedOutput = await input.reanalyze(changedSources, input.signal);
        throwIfRefreshAborted(input.signal);
        const reanalyzed = reanalyzedOutput instanceof WorkspaceIndex
            ? { index: reanalyzedOutput, semanticState: 'reanalyzed' }
            : reanalyzedOutput;
        const staleSources = findStaleReanalysisSources(reanalyzed.index, input.afterFiles, changedSources);
        if (staleSources.length > 0) {
            // A late async read is not allowed to become the persisted semantic
            // truth.  Keep the already-invalidated index and make the caller retry
            // from the current file catalog.
            await input.persist?.(input.index, changedSources, input.signal);
            return {
                index: input.index,
                result: {
                    status: 'invalidated',
                    changedSources,
                    invalidated,
                    semanticState: 'empty',
                    error: `NATIVE_REFRESH_STALE_REVISION: ${staleSources.join(', ')}`
                }
            };
        }
        const semanticState = reanalyzed.semanticState;
        throwIfRefreshAborted(input.signal);
        let publishedIndex = reanalyzed.index;
        if (input.publish) {
            notifyRefreshBoundary(input, 'publish', 'started');
            try {
                publishedIndex = await input.publish(reanalyzed.index, changedSources, input.signal);
                notifyRefreshBoundary(input, 'publish', 'completed');
            }
            catch (error) {
                notifyRefreshBoundary(input, 'publish', 'failed');
                throw error;
            }
        }
        throwIfRefreshAborted(input.signal);
        notifyRefreshBoundary(input, 'referenceBuild', 'started');
        try {
            publishedIndex.rebuildReferences();
            notifyRefreshBoundary(input, 'referenceBuild', 'completed');
        }
        catch (error) {
            notifyRefreshBoundary(input, 'referenceBuild', 'failed');
            throw error;
        }
        await input.persist?.(publishedIndex, changedSources, input.signal);
        return {
            index: publishedIndex,
            result: {
                status: semanticState === 'partial' ? 'partial' : 'converged',
                changedSources,
                invalidated,
                semanticState,
                ...(reanalyzed.error ? { error: reanalyzed.error } : {})
            }
        };
    }
    catch (error) {
        try {
            // Keep the committed bytes visible as invalidated even when reanalysis
            // timed out or the workspace generation changed. A persistence failure
            // must not escape and turn a committed write into an apparent rollback.
            await input.persist?.(input.index, changedSources, input.signal);
        }
        catch (persistError) {
            const refreshError = error instanceof Error ? error.message : String(error);
            const persistenceError = persistError instanceof Error ? persistError.message : String(persistError);
            return {
                index: input.index,
                result: {
                    status: 'failed',
                    changedSources,
                    invalidated,
                    semanticState: 'empty',
                    error: `${refreshError}; invalidated-state persistence failed: ${persistenceError}`
                }
            };
        }
        return {
            index: input.index,
            result: {
                status: 'failed',
                changedSources,
                invalidated,
                semanticState: 'empty',
                error: error instanceof Error ? error.message : String(error)
            }
        };
    }
}
function notifyRefreshBoundary(input, stage, phase) {
    try {
        input.onRefreshBoundary?.(stage, phase);
    }
    catch {
        // Diagnostic observers must not change commit refresh semantics.
    }
}
function throwIfRefreshAborted(signal) {
    if (!signal?.aborted)
        return;
    const error = new Error('post-commit knowledge refresh exceeded its deadline or was cancelled');
    error.name = 'AbortError';
    throw error;
}
function findStaleReanalysisSources(reanalyzed, afterFiles, changedSources) {
    const stale = [];
    for (const sourceUri of changedSources) {
        const expected = findCurrentFile(afterFiles, sourceUri);
        if (!expected)
            continue;
        const actual = reanalyzed.getFile(sourceUri);
        if (!actual
            || (expected.sha256 !== undefined && actual.sha256 !== expected.sha256)
            || expected.mtimeMs !== actual.mtimeMs) {
            stale.push(sourceUri);
        }
    }
    return stale;
}
function findCurrentFile(files, sourceUri) {
    const direct = files.find((file) => file.sourceUri === sourceUri);
    if (direct)
        return direct;
    const normalized = normalizeSourceToken(sourceUri);
    const matches = files.filter((file) => [file.sourceUri, file.sourcePath, file.relativePath, file.absolutePath]
        .map(normalizeSourceToken)
        .includes(normalized));
    return matches.length === 1 ? matches[0] : undefined;
}
function normalizeSourceToken(value) {
    return value.trim().replaceAll('\\', '/').replace(/^file:\/\//iu, '').toLocaleLowerCase();
}
export function detectChangedSourceUris(before, after, requestedSources = []) {
    const beforeByUri = new Map(before.map((file) => [file.sourceUri, file]));
    const changed = new Set(requestedSources.filter((sourceUri) => sourceUri.trim().length > 0));
    for (const file of after) {
        const previous = beforeByUri.get(file.sourceUri);
        if (!previous
            || previous.sha256 !== file.sha256
            || previous.size !== file.size
            || previous.mtimeMs !== file.mtimeMs
            || previous.parseStatus !== file.parseStatus) {
            changed.add(file.sourceUri);
        }
    }
    const afterUris = new Set(after.map((file) => file.sourceUri));
    for (const previous of before) {
        if (!afterUris.has(previous.sourceUri))
            changed.add(previous.sourceUri);
    }
    return [...changed];
}
//# sourceMappingURL=knowledgeRefresh.js.map