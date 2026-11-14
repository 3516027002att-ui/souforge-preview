/**
 * Coverage is deliberately more precise than a boolean.  A search result is
 * only useful for a negative conclusion when both the source set and the
 * predicate are exhaustive.
 */
export const COVERAGE_STATUSES = [
    'complete',
    'partial',
    'not_indexed',
    'parse_failed',
    'stale',
    'source_unavailable'
];
export const EXHAUSTIVE_PREDICATE_KINDS = [
    'exact_handle',
    'exact_id',
    'exact_field',
    'complete_range'
];
export function createCoverageState(input) {
    const coveredResourceIds = uniqueStrings(input.coveredResourceIds ?? []);
    const expectedResourceIds = input.expectedResourceIds === undefined
        ? null
        : input.expectedResourceIds === null
            ? null
            : uniqueStrings(input.expectedResourceIds);
    const expectedResources = input.expectedResources === undefined
        ? expectedResourceIds?.length ?? null
        : input.expectedResources;
    const predicate = normalizePredicate(input.predicateCompleteness, input.status ?? 'not_indexed');
    return {
        status: input.status ?? 'not_indexed',
        scope: input.scope,
        ...(input.domain ? { domain: input.domain } : {}),
        coveredResources: input.coveredResources ?? coveredResourceIds.length,
        expectedResources,
        coveredResourceIds,
        expectedResourceIds,
        sourceVersions: normalizeSourceVersions(input.sourceVersions ?? []),
        predicateCompleteness: predicate,
        staleSources: uniqueStrings(input.staleSources ?? []),
        diagnostics: uniqueStrings(input.diagnostics ?? [])
    };
}
/**
 * Derive a source-level coverage certificate from the file catalog and the
 * semantic projection that was actually published.
 */
export function deriveCoverageState(input) {
    const files = [...input.files];
    const expectedIds = input.expectedResourceIds === undefined
        ? uniqueStrings(files.map((file) => file.sourceUri))
        : input.expectedResourceIds === null
            ? null
            : uniqueStrings(input.expectedResourceIds);
    const coveredIds = uniqueStrings(input.coveredResourceIds ?? []);
    const staleSources = uniqueStrings(input.staleSources ?? []);
    const expected = expectedIds?.length ?? null;
    const covered = coveredIds.length;
    const parseStatuses = files.map((file) => file.parseStatus);
    const status = deriveStatus({
        files,
        expected,
        covered,
        staleSources,
        sourceUnavailable: input.sourceUnavailable === true
    });
    const predicate = normalizePredicate(input.predicate, status);
    const sourceVersions = input.sourceVersions && input.sourceVersions.length > 0
        ? normalizeSourceVersions(input.sourceVersions)
        : files.map((file) => ({
            sourceUri: file.sourceUri,
            ...(file.sha256 ? { sourceHash: file.sha256 } : {}),
            sourceRevision: file.mtimeMs
        }));
    const diagnostics = [
        ...(input.diagnostics ?? []),
        ...(parseStatuses.includes('failed') ? ['one or more sources failed to parse'] : []),
        ...(staleSources.length > 0 ? [`stale sources: ${staleSources.join(', ')}`] : [])
    ];
    return createCoverageState({
        status,
        scope: input.scope,
        ...(input.domain ? { domain: input.domain } : {}),
        coveredResources: covered,
        expectedResources: expected,
        coveredResourceIds: coveredIds,
        expectedResourceIds: expectedIds,
        sourceVersions,
        predicateCompleteness: predicate,
        staleSources,
        diagnostics
    });
}
export class CoverageStateStore {
    states = new Map();
    set(state) {
        this.states.set(coverageKey(state.scope, state.domain), cloneCoverageState(state));
    }
    get(scope = 'workspace', domain) {
        const value = this.states.get(coverageKey(scope, domain));
        return value ? cloneCoverageState(value) : undefined;
    }
    list() {
        return [...this.states.values()].map(cloneCoverageState);
    }
    clear() {
        this.states.clear();
    }
    /** Mark every state that includes a changed source as stale. */
    markStale(sourceUris, reason = 'source revision changed') {
        const changed = new Set(uniqueStrings(sourceUris));
        const changedStates = [];
        for (const [key, state] of this.states) {
            const matched = state.sourceVersions.some((version) => changed.has(version.sourceUri))
                || state.coveredResourceIds.some((sourceUri) => changed.has(sourceUri));
            if (!matched)
                continue;
            const next = createCoverageState({
                ...state,
                status: 'stale',
                predicateCompleteness: {
                    ...state.predicateCompleteness,
                    status: 'partial',
                    exhaustive: false,
                    reason: `${state.predicateCompleteness.reason}; ${reason}`
                },
                staleSources: [...state.staleSources, ...sourceUris],
                diagnostics: [...state.diagnostics, reason]
            });
            this.states.set(key, next);
            changedStates.push(cloneCoverageState(next));
        }
        return changedStates;
    }
}
export function coverageKey(scope, domain) {
    return `${scope}\u0000${domain ?? '*'}`;
}
export function isCompleteCoverage(state) {
    return state?.status === 'complete';
}
/**
 * This is the only gate that may produce NOT_FOUND_WITH_COMPLETE_COVERAGE.
 * Fuzzy/semantic retrieval is never exhaustive, even over a complete corpus.
 */
export function canConcludeNotFound(state, predicate = state?.predicateCompleteness) {
    return state?.status === 'complete'
        && predicate?.status === 'complete'
        && predicate.exhaustive
        && EXHAUSTIVE_PREDICATE_KINDS.includes(predicate.kind);
}
export function coverageForPredicate(state, kindOrPredicate) {
    if (!state || state.status !== 'complete')
        return false;
    return (state.predicateCompleteness.kind === kindOrPredicate || state.predicateCompleteness.predicate === kindOrPredicate)
        && state.predicateCompleteness.status === 'complete';
}
export function notFoundCode(state, predicate = state?.predicateCompleteness) {
    if (canConcludeNotFound(state, predicate))
        return 'NOT_FOUND_WITH_COMPLETE_COVERAGE';
    if (predicate?.kind === 'fuzzy_name' || predicate?.kind === 'semantic')
        return 'FUZZY_QUERY_NO_MATCH';
    return 'NOT_FOUND_INCOMPLETE_COVERAGE';
}
function deriveStatus(input) {
    if (input.sourceUnavailable)
        return 'source_unavailable';
    if (input.staleSources.length > 0)
        return 'stale';
    if (input.files.length === 0 && input.covered === 0)
        return 'not_indexed';
    if (input.files.some((file) => file.parseStatus === 'failed'))
        return 'parse_failed';
    if (input.files.some((file) => file.parseStatus === 'unsupported'))
        return 'parse_failed';
    if (input.files.some((file) => file.parseStatus === 'unparsed')) {
        return input.covered > 0 ? 'partial' : 'not_indexed';
    }
    if (input.files.some((file) => file.parseStatus === 'partial'))
        return 'partial';
    if (input.expected !== null && input.covered < input.expected)
        return 'partial';
    return 'complete';
}
function normalizePredicate(predicate, status) {
    const kind = predicate?.kind ?? 'unknown';
    const exhaustive = predicate?.exhaustive ?? EXHAUSTIVE_PREDICATE_KINDS.includes(kind);
    const predicateStatus = predicate?.status
        ?? (exhaustive && status === 'complete' ? 'complete' : status === 'complete' ? 'not_applicable' : 'partial');
    return {
        kind,
        status: predicateStatus,
        exhaustive,
        predicate: predicate?.predicate ?? 'unknown',
        reason: predicate?.reason
            ?? (exhaustive
                ? status === 'complete' ? 'deterministic predicate is complete' : 'source coverage is not complete'
                : 'retrieval predicate is not exhaustive'),
        ...(predicate?.missingFields && predicate.missingFields.length > 0
            ? { missingFields: uniqueStrings(predicate.missingFields) }
            : {})
    };
}
function normalizeSourceVersions(values) {
    const seen = new Set();
    return values.flatMap((value) => {
        if (!value.sourceUri || seen.has(value.sourceUri))
            return [];
        seen.add(value.sourceUri);
        return [{
                sourceUri: value.sourceUri,
                ...(value.outerFileHash ? { outerFileHash: value.outerFileHash } : {}),
                ...(value.sourceHash ? { sourceHash: value.sourceHash } : {}),
                ...(value.sourceRevision !== undefined ? { sourceRevision: value.sourceRevision } : {}),
                ...(value.readerSchemaVersion !== undefined ? { readerSchemaVersion: value.readerSchemaVersion } : {}),
                ...(value.metadataSchemaVersion ? { metadataSchemaVersion: value.metadataSchemaVersion } : {})
            }];
    });
}
function cloneCoverageState(state) {
    return {
        ...state,
        coveredResourceIds: [...state.coveredResourceIds],
        expectedResourceIds: state.expectedResourceIds ? [...state.expectedResourceIds] : null,
        sourceVersions: state.sourceVersions.map((version) => ({ ...version })),
        predicateCompleteness: {
            ...state.predicateCompleteness,
            ...(state.predicateCompleteness.missingFields
                ? { missingFields: [...state.predicateCompleteness.missingFields] }
                : {})
        },
        staleSources: [...state.staleSources],
        diagnostics: [...state.diagnostics]
    };
}
function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))];
}
//# sourceMappingURL=coverageState.js.map