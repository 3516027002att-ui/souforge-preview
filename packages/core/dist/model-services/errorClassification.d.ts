/**
 * Structured error classification for model-service adapters.
 * Differentiates network, timeout, rate-limit, server, client and parse failures.
 */
import type { ModelCompleteResult, StreamEvent } from './types.js';
export interface ModelServiceDiagnostic {
    severity: 'error';
    code: string;
    message: string;
    /** Parsed Retry-After hint in milliseconds, when the server supplied one. */
    retryAfterMs?: number;
}
/**
 * Parse an HTTP Retry-After header into milliseconds. Supports delta-seconds
 * (e.g. "30") and HTTP-date forms. Returns undefined when absent or invalid.
 */
export declare function parseRetryAfterHeader(header: string | null | undefined): number | undefined;
export interface FetchErrorClassificationOptions {
    /**
     * The caller-supplied signal (not the combined timeout+caller signal).
     * Lets the classifier distinguish an active caller cancellation
     * (MODEL_SERVICE_CANCELLED) from an internal timeout (MODEL_SERVICE_TIMEOUT)
     * instead of collapsing both into one code.
     */
    callerSignal?: AbortSignal | undefined;
}
export declare function classifyFetchError(error: unknown, protocol: string, signal?: AbortSignal, options?: FetchErrorClassificationOptions): ModelServiceDiagnostic;
export declare function classifyHttpError(status: number, bodyText: string, protocol: string, retryAfterHeader?: string | null): ModelServiceDiagnostic;
export declare function classifyParseError(error: unknown, protocol: string): ModelServiceDiagnostic;
export declare function errorResult(diagnostic: ModelServiceDiagnostic): ModelCompleteResult;
export declare function errorStreamEvent(diagnostic: ModelServiceDiagnostic): StreamEvent;
/**
 * Create a combined AbortSignal from an optional caller signal and an optional timeout.
 * Returns the signal and a cleanup function to clear the timeout timer.
 */
export declare function createRequestSignal(callerSignal?: AbortSignal, timeoutMs?: number): {
    signal: AbortSignal | undefined;
    cleanup: () => void;
};
