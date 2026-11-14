/**
 * Opt-in timing for the TypeScript Bridge transport boundary.
 *
 * Native timing is intentionally kept in the daemon's own schema.  This
 * collector only describes the client-side request/materialization path, so
 * the two measurements cannot be accidentally added together by consumers.
 */
export const BRIDGE_TRANSPORT_TIMING_CODE = 'BRIDGE_TRANSPORT_TIMINGS';
export const BRIDGE_TRANSPORT_TIMING_SCHEMA_VERSION = 1;
export const BRIDGE_TRANSPORT_TIMING_UNIT = 'ms';
export const BRIDGE_TRANSPORT_TIMING_METRICS = Object.freeze([
    'poolAcquireMs',
    'daemonRequestMs',
    'artifactRequestCount',
    'artifactRequestMs',
    'base64DecodeMs',
    'concatJsonParseMs',
    'materializeTotalMs',
    'totalMs'
]);
function monotonicNow() {
    return process.hrtime.bigint();
}
function elapsedMs(startedAt) {
    const value = Number(monotonicNow() - startedAt) / 1_000_000;
    return Number.isFinite(value) && value >= 0 ? value : null;
}
function isDurationMetric(metric) {
    return metric !== 'artifactRequestCount';
}
function metricIsActive(metric, artifactExpected) {
    return metric === 'poolAcquireMs'
        || metric === 'daemonRequestMs'
        || metric === 'totalMs'
        || artifactExpected;
}
function metricAllowsRepeatedScopes(metric) {
    return metric === 'artifactRequestMs' || metric === 'base64DecodeMs';
}
/** Create one request-local collector. Callers only construct it for opt-in requests. */
export function createBridgeTransportTimingCollector() {
    const startedAt = monotonicNow();
    const values = new Map();
    const statuses = new Map();
    const activeScopes = new Set();
    let artifactExpected = false;
    let artifactRequestCount = 0;
    let finished = null;
    const begin = (metric) => {
        if (finished || !isDurationMetric(metric))
            return null;
        if (statuses.has(metric) && !metricAllowsRepeatedScopes(metric))
            return null;
        const scope = { metric, startedAt: monotonicNow() };
        activeScopes.add(scope);
        return scope;
    };
    const end = (scope) => {
        if (!scope || finished || !activeScopes.has(scope))
            return;
        activeScopes.delete(scope);
        const value = elapsedMs(scope.startedAt);
        if (value === null) {
            statuses.set(scope.metric, 'unavailable');
            values.set(scope.metric, null);
            return;
        }
        if (statuses.get(scope.metric) === 'unavailable')
            return;
        statuses.set(scope.metric, 'measured');
        values.set(scope.metric, (values.get(scope.metric) ?? 0) + value);
    };
    const skip = (metric) => {
        if (finished || activeScopes.size > 0 || statuses.has(metric))
            return;
        statuses.set(metric, 'skipped');
        values.set(metric, null);
    };
    const markArtifactExpected = () => {
        if (!finished)
            artifactExpected = true;
    };
    const recordArtifactRequest = () => {
        if (!finished)
            artifactRequestCount += 1;
    };
    const finish = (outcome) => {
        if (finished)
            return finished;
        // An interrupted child scope is not a valid measurement. In particular,
        // cancellation must never become a small but plausible duration value.
        for (const scope of activeScopes) {
            statuses.set(scope.metric, 'unavailable');
            values.set(scope.metric, null);
        }
        activeScopes.clear();
        for (const metric of BRIDGE_TRANSPORT_TIMING_METRICS) {
            if (statuses.has(metric))
                continue;
            if (metric === 'artifactRequestCount') {
                const artifactRequestInFlight = [...statuses.entries()].some(([key, status]) => key === 'artifactRequestMs' && status === 'unavailable');
                if (artifactExpected && !artifactRequestInFlight) {
                    statuses.set(metric, 'measured');
                    values.set(metric, artifactRequestCount);
                }
                else if (artifactExpected) {
                    statuses.set(metric, 'unavailable');
                    values.set(metric, null);
                }
                else {
                    statuses.set(metric, 'skipped');
                    values.set(metric, null);
                }
                continue;
            }
            if (metric === 'totalMs')
                continue;
            if (metricIsActive(metric, artifactExpected)) {
                statuses.set(metric, 'unavailable');
            }
            else {
                statuses.set(metric, 'skipped');
            }
            values.set(metric, null);
        }
        const total = elapsedMs(startedAt);
        statuses.set('totalMs', total === null ? 'unavailable' : 'measured');
        values.set('totalMs', total);
        const unavailableMetrics = BRIDGE_TRANSPORT_TIMING_METRICS.filter((metric) => statuses.get(metric) === 'unavailable');
        const skippedMetrics = BRIDGE_TRANSPORT_TIMING_METRICS.filter((metric) => statuses.get(metric) === 'skipped');
        finished = {
            schemaVersion: BRIDGE_TRANSPORT_TIMING_SCHEMA_VERSION,
            unit: BRIDGE_TRANSPORT_TIMING_UNIT,
            requestCount: 1,
            outcome,
            metricOrder: [...BRIDGE_TRANSPORT_TIMING_METRICS],
            unavailableMetrics,
            skippedMetrics,
            metricStatus: Object.fromEntries(BRIDGE_TRANSPORT_TIMING_METRICS.map((metric) => [metric, statuses.get(metric)])),
            metricKinds: Object.fromEntries(BRIDGE_TRANSPORT_TIMING_METRICS.map((metric) => [
                metric,
                metric === 'artifactRequestCount' ? 'count' : 'ms'
            ])),
            metrics: Object.fromEntries(BRIDGE_TRANSPORT_TIMING_METRICS.map((metric) => [metric, {
                    status: statuses.get(metric),
                    value: values.get(metric) ?? null
                }]))
        };
        return finished;
    };
    return { begin, end, skip, markArtifactExpected, recordArtifactRequest, finish };
}
//# sourceMappingURL=bridgeTransportTiming.js.map