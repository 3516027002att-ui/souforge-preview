/**
 * Two-tier retry/backoff policy for model-service calls.
 * Design derived from openai/codex (Apache-2.0, Copyright 2025 OpenAI) —
 * codex-client/retry.rs (request-level RetryPolicy) and responses_retry.rs
 * (stream-level retries). Design source: https://github.com/openai/codex; attribution: NOTICE.
 *
 * Codex semantics preserved:
 * - exponential backoff 200ms × 2^(attempt-1) with ±10% jitter
 * - server Retry-After takes precedence when larger than the computed delay
 * - explicit retryable whitelist derived from error classification
 * - attempt budget capped at 100
 * Divergence: Codex keeps HTTP 429 out of the request-level retry path
 * (rate limits land on the stream level via Retry-After). SoulForge treats
 * RATE_LIMITED as retryable on both paths and honors retryAfterMs, because
 * the non-streaming complete() path has no separate stream-level tier.
 */
import type { RetryPolicyOptions } from './types.js';
/** Structural diagnostic shape accepted by retry decisions. */
export interface RetryableDiagnosticInput {
    severity: string;
    code: string;
    message: string;
    retryAfterMs?: number;
}
export interface ResolvedRetryPolicy {
    maxAttempts: number;
    baseDelayMs: number;
    backoffFactor: number;
    jitterRatio: number;
    maxDelayMs: number;
}
/** Stream-level retry budget when the loop consumes adapter.stream(). */
export declare const DEFAULT_STREAM_MAX_RETRIES = 5;
export declare const MAX_RETRY_ATTEMPTS_CAP = 100;
export declare const DEFAULT_RETRY_POLICY: ResolvedRetryPolicy;
export declare function isRetryableErrorCode(code: string): boolean;
export declare function resolveRetryPolicy(options?: RetryPolicyOptions): ResolvedRetryPolicy;
/**
 * Compute the backoff delay for a given attempt (1-based). When the server
 * supplied a Retry-After hint and it exceeds the computed delay, the hint
 * wins.
 */
export declare function computeBackoffDelayMs(policy: ResolvedRetryPolicy, attempt: number, retryAfterMs?: number, random?: () => number): number;
export interface RetryDecision {
    retry: boolean;
    delayMs: number;
    code?: string;
}
/**
 * Decide whether a failed completion should be retried. `attempt` is the
 * 1-based count of attempts already made (including the failed one).
 */
export declare function decideRetry(diagnostics: RetryableDiagnosticInput[], attempt: number, policy: ResolvedRetryPolicy, random?: () => number): RetryDecision;
/** Sleep that resolves early with 'cancelled' when the signal aborts. */
export declare function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<'ok' | 'cancelled'>;
