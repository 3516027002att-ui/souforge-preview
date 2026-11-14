/**
 * Context compaction: summarizes oversized history and atomically replaces it.
 * Design derived from openai/codex (Apache-2.0, Copyright 2025 OpenAI) —
 * core/compact.rs build_compacted_history + the pre-sampling/mid-turn trigger
 * points in session/turn.rs. Design source: https://github.com/openai/codex; attribution: NOTICE.
 *
 * Preserved Codex semantics:
 * - trigger on a token limit evaluated before each model call
 * - compaction runs one summarization request and takes the final assistant
 *   message as the summary
 * - replacement history = leading system context + recent user messages
 *   (reverse scan within a 20k-token budget) + one summary message carrying
 *   a fixed prefix
 * - when the summary request itself exceeds the window, the oldest
 *   non-system item is dropped and the request retried
 * Divergence: the original history stays with the caller/rollout — this
 * module is pure and never touches persistence itself.
 */
import type { ChatMessage, CompactionOptions, ModelServiceAdapter } from './types.js';
export declare const DEFAULT_USER_MESSAGE_BUDGET_TOKENS = 20000;
/** 摘要请求输入里 tool 结果的最大字符数（OpenCode/Cline 同款 2000 字符限制）。 */
export declare const TOOL_RESULT_CHAR_LIMIT = 2000;
/**
 * 摘要输出预算：压缩请求自身的 max_tokens。
 * 对齐 OpenCode V2 SUMMARY_OUTPUT_TOKENS=4096 与 Cline DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS=4096；
 * Anthropic 适配器无显式 max_tokens 时默认 1024，摘要会明显偏短。
 */
export declare const DEFAULT_SUMMARY_MAX_TOKENS = 4096;
/**
 * 压缩后历史至少保留的最近 user 消息条数（Hermes _MAX_TAIL_MESSAGE_FLOOR=8 的
 * 保守版）：预算极小（如触发阈值设得低）时也保底保留最近两条，避免丢失当前
 * 任务的直接上下文。
 */
export declare const MIN_KEPT_USER_MESSAGES = 2;
/**
 * 结构化摘要模板（OpenCode SUMMARY_TEMPLATE 风格）。要点：
 * - 明确目标 / 事实 / 工作状态 / 下一步 / 相关文件，让接手模型能直接续作；
 * - 强调保留函数名、ID、文件名、flag 等精确标识（Aider 同款约束）；
 * - 禁止提及压缩过程本身（OpenCode 模板同款要求）。
 */
export declare const DEFAULT_SUMMARIZATION_PROMPT: string;
export declare const DEFAULT_SUMMARY_PREFIX = "\u3010\u4E0A\u4E0B\u6587\u6458\u8981\u3011\u4EE5\u4E0B\u4E3A\u5148\u524D\u5BF9\u8BDD\u7684\u538B\u7F29\u6458\u8981\uFF0C\u539F\u59CB\u5386\u53F2\u5DF2\u5F52\u6863\uFF1A";
/** Rough token estimate: ~4 characters per token plus per-message overhead. */
export declare function estimateMessageTokens(message: ChatMessage): number;
/**
 * 摘要请求输入的预裁剪（OpenCode prune / Hermes 剪旧 tool 结果的轻量版）：
 * 大 tool 结果是上下文膨胀主因，也常是摘要请求自身超窗的原因——先把 tool
 * 结果截到 TOOL_RESULT_CHAR_LIMIT（2000 字符），比「删整条消息重试」更保守、
 * 保留更多信息。裁剪只作用于摘要请求的输入，不触碰原历史。
 */
export declare function trimToolResultsForSummary(messages: readonly ChatMessage[]): ChatMessage[];
/**
 * 历史轮次工具结果渐进修剪（Codex & OpenCode context management 机制）：
 * 在多轮会话持续推进时，保留最近 keepLastTurns 轮的完整 tool 输出；
 * 对于更早轮次（历史轮次）中超长（> maxCharsPerTool）的 tool 结果进行修剪，
 * 将其缩减为带概要的片段，防止历史 tool 输出无谓消耗宝贵的上下文窗口。
 */
export declare function pruneHistoricalToolOutputs(messages: readonly ChatMessage[], keepLastTurns?: number, maxCharsPerTool?: number): ChatMessage[];
export declare function estimateContextTokens(messages: ChatMessage[]): number;
export type CompactionResult = {
    ok: true;
    replacementMessages: ChatMessage[];
    summary: string;
    diagnostics: [];
} | {
    ok: false;
    code: 'COMPACTION_SUMMARY_FAILED' | 'COMPACTION_CANCELLED' | 'insufficient_evidence';
    message: string;
    diagnostics: Array<{
        severity: 'error';
        code: string;
        message: string;
    }>;
};
export declare function isContextOverflowDiagnostic(diagnostics: ReadonlyArray<{
    severity: string;
    code: string;
    message: string;
}>): boolean;
export interface CompactionRequest {
    messages: ChatMessage[];
    signal?: AbortSignal;
    timeoutMs?: number;
    options?: CompactionOptions;
}
/**
 * 判断一条消息是否为本机制生成的旧摘要（以 summaryPrefix 开头）。
 * 压缩保留预算里必须剔除旧摘要：否则第二次压缩会把旧摘要当作普通 user
 * 消息保留进 20k 预算，既浪费预算又让接手模型读到过期摘要（Codex 的
 * is_summary_message 同款过滤，compact.rs:567）。
 */
export declare function isSummaryMessage(message: ChatMessage, summaryPrefix?: string): boolean;
/**
 * Build the replacement history from the original one plus a summary.
 * Leading system messages are kept as initial context; recent user messages
 * are kept verbatim within the token budget (most recent first), excluding
 * previous summary messages; the new summary lands as the final user message.
 */
export declare function buildCompactedHistory(originalMessages: ChatMessage[], summary: string, options?: Pick<CompactionOptions, 'userMessageBudgetTokens' | 'summaryPrefix'>): ChatMessage[];
export declare function runCompaction(adapter: ModelServiceAdapter, request: CompactionRequest): Promise<CompactionResult>;
