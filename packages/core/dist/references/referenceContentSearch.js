import { createHash } from 'node:crypto';
import { enrichReferenceContent } from './nativeReferenceContent.js';
function scanScope(input) {
    const { cursor: _cursor, sourceCursor: _sourceCursor, cursorScopeCheckRequired: _check, ...scope } = input;
    return scope;
}
function scopeKey(scope) {
    return JSON.stringify(Object.entries(scope).sort(([a], [b]) => a.localeCompare(b)));
}
/** Prepare bounded, read-only source content before locking a relation page. */
export async function prepareReferenceContentSearch(options) {
    const scope = scanScope(options.input);
    const hash = createHash('sha256');
    // Child ordering and enrichment reuse are part of the continuation contract.
    // Never replay an older scan offset under the new target-first order.
    hash.update('reference-content-scan-v2\0');
    for (const file of options.index.getFiles().sort((a, b) => a.sourceUri.localeCompare(b.sourceUri))) {
        hash.update(JSON.stringify([file.sourceUri, file.sha256, file.mtimeMs, file.size])).update('\0');
    }
    const sourceVersionKey = hash.digest('hex');
    // The scan is the expensive half of find_references (measured 13.2 s, then 11.7 s for the very same
    // query in the same session). Once a source set has been scanned for a query, replay the outcome
    // until the indexed sources change: sourceVersionKey covers every file's hash/mtime/size.
    const memoKey = `${options.index.workspaceId}|${sourceVersionKey}|${scopeKey(scope)}|${options.targetUri ?? ''}|${options.domains?.join(',') ?? 'all'}`;
    const memoized = contentScanMemo.get(memoKey);
    if (memoized !== undefined && options.input.sourceCursor === undefined)
        return {
            scan: { ...memoized.scan },
            diagnostics: memoized.diagnostics.map((item) => ({ ...item })),
            channel: { event: { ...memoized.channel.event }, param: { ...memoized.channel.param }, script: { ...memoized.channel.script } }
        };
    let cursor;
    if (options.input.sourceCursor) {
        const stored = options.store.get(options.input.sourceCursor);
        if (!stored || stored.rootUri !== 'reference-source-scan://' || stored.sourceScanState === undefined
            || stored.workspaceId !== options.index.workspaceId || scopeKey(stored.scope) !== scopeKey(scope)) {
            throw Object.assign(new Error('扫描游标已过期或与当前查询、工作区不匹配，请重新查询。'), { code: 'REFERENCE_SCAN_CURSOR_SCOPE_MISMATCH' });
        }
        if (stored.sourceVersionKey !== sourceVersionKey) {
            throw Object.assign(new Error('待扫描来源已变化，请重新查询。'), { code: 'STALE_READ_CURSOR' });
        }
        cursor = stored.sourceScanState;
    }
    const enriched = await enrichReferenceContent({
        index: options.index, edit: options.edit,
        ...(cursor ? { cursor } : {}),
        ...(options.registry ? { registry: options.registry } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.input.target && 'domain' in options.input.target && options.input.target.domain === 'script' ? {
            targetUri: `${options.input.target.sourceUri}!/${options.input.target.childChain.join('/')}`
        } : options.targetUri ? { targetUri: options.targetUri } : {}),
        ...(options.prioritySourceUris ? { prioritySourceUris: options.prioritySourceUris } : {}),
        ...(options.maxSourcesByDomain ? { maxSourcesByDomain: options.maxSourcesByDomain } : {}),
        ...(options.domains ? { domains: options.domains } : {}),
        maxSources: 2, maxScripts: 2, maxBytes: 512 * 1024, timeoutMs: 20000,
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {})
    });
    if (enriched.updatedSourceUris.length > 0)
        await options.persist?.(enriched.updatedSourceUris);
    const sourceCursor = enriched.nextCursor ? options.store.issue({
        workspaceId: options.index.workspaceId,
        scope, rootUri: 'reference-source-scan://', relationOffset: 0,
        sourceVersionKey, sourceScanState: enriched.nextCursor,
        dependencySummary: { catalogGeneration: 0, entries: [] }
    }) : undefined;
    const result = {
        scan: {
            remaining: Boolean(enriched.nextCursor),
            complete: enriched.complete,
            failedCount: enriched.failedSourceKeys.length,
            ...(sourceCursor ? {
                sourceCursor,
                nextAction: { tool: 'find_references', args: { ...scope, sourceCursor }, reason: '继续搜索尚未读取的文件内容，然后刷新关联结果' }
            } : enriched.failedSourceKeys.length > 0 ? {
                nextAction: { tool: 'find_references', args: { ...scope }, reason: '部分来源读取失败；重新查询以重试未完成内容' }
            } : {})
        },
        diagnostics: [...(enriched.failedSourceKeys.length > 0 ? [{ severity: 'warning', code: 'NATIVE_REFERENCE_INCOMPLETE', message: `${enriched.failedSourceKeys.length} 个来源或子项未能读取完整内容，可重新查询重试。` }] : []), ...enriched.diagnostics].slice(0, 8).map(({ severity, code, message, sourceUri }) => ({
            severity: severity === 'error' ? 'error' : severity === 'info' ? 'info' : 'warning',
            code, message, ...(sourceUri ? { sourceUri } : {})
        })),
        channel: enriched.domainProgress
    };
    // Only a finished scan is replayable: a paged one carries a cursor that the store must keep issuing.
    if (enriched.nextCursor === undefined && options.input.sourceCursor === undefined) {
        contentScanMemo.set(memoKey, result);
        if (contentScanMemo.size > 32) {
            const oldest = contentScanMemo.keys().next();
            if (!oldest.done)
                contentScanMemo.delete(oldest.value);
        }
    }
    return result;
}
/** scan outcome per (workspace, indexed-source version, query scope, target). */
const contentScanMemo = new Map();
//# sourceMappingURL=referenceContentSearch.js.map