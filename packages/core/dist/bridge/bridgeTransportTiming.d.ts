/**
 * Opt-in timing for the TypeScript Bridge transport boundary.
 *
 * Native timing is intentionally kept in the daemon's own schema.  This
 * collector only describes the client-side request/materialization path, so
 * the two measurements cannot be accidentally added together by consumers.
 */
export declare const BRIDGE_TRANSPORT_TIMING_CODE = "BRIDGE_TRANSPORT_TIMINGS";
export declare const BRIDGE_TRANSPORT_TIMING_SCHEMA_VERSION = 1;
export declare const BRIDGE_TRANSPORT_TIMING_UNIT = "ms";
export declare const BRIDGE_TRANSPORT_TIMING_METRICS: readonly ["poolAcquireMs", "daemonRequestMs", "artifactRequestCount", "artifactRequestMs", "base64DecodeMs", "concatJsonParseMs", "materializeTotalMs", "totalMs"];
export type BridgeTransportTimingMetric = typeof BRIDGE_TRANSPORT_TIMING_METRICS[number];
export type BridgeTransportTimingStatus = 'measured' | 'skipped' | 'unavailable';
export type BridgeTransportTimingOutcome = 'ok' | 'failed' | 'cancelled';
type RecordLike = Record<string, unknown>;
type TimingScope = {
    metric: BridgeTransportTimingMetric;
    startedAt: bigint;
} | null;
export interface BridgeTransportTimingCollector {
    begin(metric: Exclude<BridgeTransportTimingMetric, 'artifactRequestCount'>): TimingScope;
    end(scope: TimingScope): void;
    skip(metric: BridgeTransportTimingMetric): void;
    markArtifactExpected(): void;
    recordArtifactRequest(): void;
    finish(outcome: BridgeTransportTimingOutcome): RecordLike;
}
/** Create one request-local collector. Callers only construct it for opt-in requests. */
export declare function createBridgeTransportTimingCollector(): BridgeTransportTimingCollector;
export {};
