/**
 * Append-only session rollout recorder (Codex rollout crate design, minimized).
 * Design derived from openai/codex (Apache-2.0, Copyright 2025 OpenAI) —
 * rollout/recorder.rs single-writer model, tolerant resume parsing and
 * marker-based rollback. Design source: https://github.com/openai/codex; attribution: NOTICE.
 *
 * Preserved Codex semantics:
 * - JSONL, first line is session meta
 * - single logical writer: enqueue() is sync, I/O is serialized behind a
 *   drain promise (Codex's dedicated writer task + command channel)
 * - flush() is a barrier that waits for all queued items to land
 * - storage failures enter recovery mode: pending items are retained and
 *   retried at the next drain instead of being lost
 * - resume tolerates malformed lines (parse_errors counted, never fatal)
 * - rollback never deletes durable lines — a rollback marker truncates
 *   logically at parse time
 * Divergence: no zstd compression, no sqlite index, no reverse scanner —
 * storage is an injected interface so callers choose the location
 * (never the Mod workspace).
 */
import type { ChatMessage, RolloutItem, RolloutSessionMeta, RolloutSink } from './types.js';
export interface RolloutStorage {
    appendLines(lines: string[]): Promise<void>;
    readLines(): Promise<string[]>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
export declare class InMemoryRolloutStorage implements RolloutStorage {
    private readonly stored;
    private closed;
    appendLines(lines: string[]): Promise<void>;
    readLines(): Promise<string[]>;
    flush(): Promise<void>;
    close(): Promise<void>;
    get lines(): string[];
}
export declare class RolloutRecorder implements RolloutSink {
    private readonly limits;
    private readonly storage;
    private readonly meta;
    private queue;
    private queuedBytes;
    private inFlightBytes;
    private inFlightItems;
    private drainChain;
    private metaWritten;
    private closed;
    /** Last storage failure; retained items are retried on the next drain. */
    lastError: string | null;
    constructor(storage: RolloutStorage, meta: RolloutSessionMeta, limits?: {
        maxQueuedBytes?: number;
        maxQueuedItems?: number;
    });
    enqueue(item: RolloutItem): void;
    private drain;
    flush(): Promise<void>;
    close(): Promise<void>;
}
export interface ResumedRollout {
    meta: RolloutSessionMeta | null;
    messages: ChatMessage[];
    /** Highest recorded step, 0 when no message items exist. */
    steps: number;
    parseErrors: number;
    interrupted: boolean;
    compactedWindows: number;
    providerUsage?: {
        calls: number;
        reportedCalls: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        lastContextTokens: number | null;
    };
    /** Last durable terminal record; absent for legacy/in-progress rollouts. */
    terminal?: Extract<RolloutItem, {
        type: 'turn-complete';
    }> | null;
}
/**
 * Rollback a parsed message list to the last `keepLastUserTurns` user turns.
 * A turn boundary is a user message; everything from that boundary onward is
 * kept. With no user messages the full list is kept unchanged.
 */
export declare function truncateToLastUserTurns(messages: ChatMessage[], keepLastUserTurns: number): ChatMessage[];
/**
 * Parse rollout JSONL lines back into a resumable history. Malformed lines are
 * counted, never fatal. A trailing rollback marker truncates logically;
 * durable lines are never rewritten.
 */
export declare function parseRolloutLines(lines: string[]): ResumedRollout;
/** Load and parse a rollout from storage (resume entry point). */
export declare function loadRollout(storage: RolloutStorage): Promise<ResumedRollout>;
