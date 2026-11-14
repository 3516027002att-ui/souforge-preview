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
import { redactSecrets } from './agentPolicy.js';
export class InMemoryRolloutStorage {
    stored = [];
    closed = false;
    async appendLines(lines) {
        if (this.closed)
            throw new Error('ROLLOUT_STORAGE_CLOSED: 存储已关闭。');
        this.stored.push(...lines);
    }
    async readLines() {
        return [...this.stored];
    }
    async flush() { }
    async close() {
        this.closed = true;
    }
    get lines() {
        return [...this.stored];
    }
}
function redactMessage(message) {
    return {
        ...message,
        content: redactSecrets(message.content),
        ...(message.toolCalls
            ? {
                toolCalls: message.toolCalls.map((call) => ({
                    ...call,
                    argumentsJson: redactSecrets(call.argumentsJson)
                }))
            }
            : {})
    };
}
function redactItem(item) {
    if (item.type !== 'message')
        return item;
    return { ...item, message: redactMessage(item.message) };
}
export class RolloutRecorder {
    limits;
    storage;
    meta;
    queue = [];
    queuedBytes = 0;
    inFlightBytes = 0;
    inFlightItems = 0;
    drainChain = Promise.resolve();
    metaWritten = false;
    closed = false;
    /** Last storage failure; retained items are retried on the next drain. */
    lastError = null;
    constructor(storage, meta, limits = {}) {
        this.limits = limits;
        this.storage = storage;
        this.meta = meta;
    }
    enqueue(item) {
        if (this.closed)
            return;
        const redacted = redactItem(item);
        const bytes = Buffer.byteLength(JSON.stringify(redacted), 'utf8');
        if (this.queuedBytes + this.inFlightBytes + bytes > (this.limits.maxQueuedBytes ?? 16 * 1024 * 1024)
            || this.queue.length + this.inFlightItems >= (this.limits.maxQueuedItems ?? 4096)) {
            throw Object.assign(new Error('Rollout storage cannot keep up with the bounded session queue.'), { code: 'ROLLOUT_QUEUE_BUDGET_EXCEEDED' });
        }
        this.queue.push(redacted);
        this.queuedBytes += bytes;
        this.drainChain = this.drainChain.then(() => this.drain());
    }
    async drain() {
        const lines = [];
        if (!this.metaWritten) {
            const metaItem = { type: 'session-meta', meta: this.meta };
            lines.push(JSON.stringify(metaItem));
        }
        const pending = this.queue;
        const pendingBytes = this.queuedBytes;
        this.queue = [];
        this.queuedBytes = 0;
        this.inFlightBytes += pendingBytes;
        this.inFlightItems += pending.length;
        for (const item of pending) {
            lines.push(JSON.stringify(item));
        }
        if (lines.length === 0)
            return;
        try {
            await this.storage.appendLines(lines);
            this.metaWritten = true;
            this.lastError = null;
        }
        catch (error) {
            // Recovery mode: keep everything unwritten for the next barrier.
            this.queue = [...pending, ...this.queue];
            this.queuedBytes += pendingBytes;
            this.lastError = error instanceof Error ? error.message : String(error);
        }
        finally {
            this.inFlightBytes -= pendingBytes;
            this.inFlightItems -= pending.length;
        }
    }
    async flush() {
        await this.drainChain;
        // A previous append may have failed after enqueue scheduled its only
        // drain. A barrier must actively retry retained items; merely awaiting the
        // old chain would silently leave them in memory.
        this.drainChain = this.drainChain.then(() => this.drain());
        await this.drainChain;
        if (!this.metaWritten || this.queue.length > 0 || this.lastError !== null) {
            const cause = this.lastError ?? '仍有未持久化的 rollout 条目。';
            const error = new Error(`ROLLOUT_FLUSH_FAILED: ${cause}`);
            error.code = 'ROLLOUT_FLUSH_FAILED';
            throw error;
        }
        try {
            await this.storage.flush();
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            const failure = new Error(`ROLLOUT_FLUSH_FAILED: ${this.lastError}`);
            failure.code = 'ROLLOUT_FLUSH_FAILED';
            throw failure;
        }
        this.lastError = null;
    }
    async close() {
        await this.flush();
        this.closed = true;
        await this.storage.close();
    }
}
/**
 * Rollback a parsed message list to the last `keepLastUserTurns` user turns.
 * A turn boundary is a user message; everything from that boundary onward is
 * kept. With no user messages the full list is kept unchanged.
 */
export function truncateToLastUserTurns(messages, keepLastUserTurns) {
    if (keepLastUserTurns <= 0)
        return [];
    let seen = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === 'user') {
            seen += 1;
            if (seen >= keepLastUserTurns) {
                return messages.slice(index);
            }
        }
    }
    return messages;
}
/**
 * Parse rollout JSONL lines back into a resumable history. Malformed lines are
 * counted, never fatal. A trailing rollback marker truncates logically;
 * durable lines are never rewritten.
 */
export function parseRolloutLines(lines) {
    let meta = null;
    let parseErrors = 0;
    let interrupted = false;
    let compactedWindows = 0;
    let steps = 0;
    let rollbackKeep = null;
    let terminal = null;
    const providerUsage = {
        calls: 0,
        reportedCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        lastContextTokens: null
    };
    const messages = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        let item;
        try {
            item = JSON.parse(trimmed);
        }
        catch {
            parseErrors += 1;
            continue;
        }
        switch (item.type) {
            case 'session-meta':
                if (!meta)
                    meta = item.meta;
                break;
            case 'message':
                messages.push(item.message);
                steps = Math.max(steps, item.step);
                break;
            case 'interrupted':
                interrupted = true;
                break;
            case 'compacted':
                compactedWindows += 1;
                // 压缩标记携带替换历史（新格式）：从该点起历史 = 压缩后的窗口内容，
                // 后续 message 条目继续追加。旧格式（无 replacementHistory）只计数，
                // 保持历史原样 —— 旧会话 resume 不会崩，只是无法回退到压缩窗口。
                if (item.replacementHistory && item.replacementHistory.length > 0) {
                    messages.length = 0;
                    messages.push(...item.replacementHistory);
                }
                break;
            case 'provider-usage':
                providerUsage.calls += 1;
                if (item.providerReported)
                    providerUsage.reportedCalls += 1;
                providerUsage.totalInputTokens += item.inputTokens ?? 0;
                providerUsage.totalOutputTokens += item.outputTokens ?? 0;
                providerUsage.lastContextTokens = item.currentContextTokens;
                break;
            case 'protocol-event':
                // Protocol observation is valid audit history, not a second provider
                // message or terminal task-completion record.
                if (item.envelope?.protocolVersion !== 1
                    || !Number.isSafeInteger(item.envelope.eventSeq) || item.envelope.eventSeq < 1
                    || typeof item.envelope.sessionId !== 'string'
                    || typeof item.envelope.runId !== 'string' || typeof item.envelope.requestId !== 'string'
                    || typeof item.envelope.event?.type !== 'string')
                    parseErrors += 1;
                break;
            case 'rollback-marker':
                rollbackKeep = item.keepLastUserTurns;
                break;
            case 'turn-complete':
                terminal = item;
                steps = Math.max(steps, item.steps);
                break;
            default:
                parseErrors += 1;
        }
    }
    if (rollbackKeep !== null) {
        const truncated = truncateToLastUserTurns(messages, rollbackKeep);
        messages.length = 0;
        messages.push(...truncated);
    }
    return { meta, messages, steps, parseErrors, interrupted, compactedWindows, providerUsage, terminal };
}
/** Load and parse a rollout from storage (resume entry point). */
export async function loadRollout(storage) {
    const lines = await storage.readLines();
    return parseRolloutLines(lines);
}
//# sourceMappingURL=rolloutRecorder.js.map