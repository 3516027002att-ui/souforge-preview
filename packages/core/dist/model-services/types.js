/**
 * Dual model-service contracts (OpenAI-compatible + Anthropic-compatible).
 * Credentials never appear in renderer DTOs or audit payloads.
 */
export function isModelThinkingLevel(value) {
    return value === 'off' || value === 'none' || value === 'minimal'
        || value === 'low' || value === 'medium' || value === 'high'
        || value === 'xhigh' || value === 'max';
}
/** 读路径兼容：遗留档 → 官方档；未知值回退默认档 medium。 */
export function migrateThinkingLevel(level) {
    switch (level) {
        case 'fast': return 'low';
        case 'normal': return 'medium';
        case 'deep': return 'high';
        case 'extreme': return 'max';
        default: return isModelThinkingLevel(level) ? level : 'medium';
    }
}
/**
 * OpenAI 兼容（chat `reasoning_effort` / responses `reasoning.effort`）映射；
 * off/未配置返回 undefined（不下发）。官方值原样下发，禁止把 max 折成 high。
 * 遗留档（fast/normal/deep/extreme）读路径兼容映射（deep→high、extreme→max）。
 */
export function resolveOpenAiReasoningEffort(level) {
    if (level === undefined || level === 'off')
        return undefined;
    switch (level) {
        case 'fast': return 'low';
        case 'normal': return 'medium';
        case 'deep': return 'high';
        case 'extreme': return 'max';
        default: return level;
    }
}
/**
 * Anthropic `output_config.effort` 映射；off/未配置返回 undefined（不下发）。
 * none/minimal 是 OpenAI 专有档，Anthropic 不下发。遗留档读路径兼容映射。
 */
export function resolveAnthropicEffort(level) {
    if (level === undefined || level === 'off')
        return undefined;
    switch (level) {
        case 'fast': return 'low';
        case 'normal': return 'medium';
        case 'deep': return 'high';
        case 'extreme': return 'max';
        case 'none':
        case 'minimal': return undefined;
        default: return level;
    }
}
/**
 * 遗留 `thinking.budget_tokens` 映射：仅「明确仍走 manual extended thinking」的
 * 内部路径可用；**UI 与下拉不得再走这条路**（2026 的 Anthropic 用 output_config.effort，
 * budget_tokens 数字不得冒充 effort）。
 */
export function resolveAnthropicThinkingBudget(level) {
    switch (level) {
        case 'fast': return 2048;
        case 'normal': return 4096;
        case 'deep': return 8192;
        case 'extreme': return 16384;
        default: return undefined;
    }
}
/** 会进入会话记忆的决定：只有这两个跨调用生效。 */
export const APPROVAL_DECISIONS_WITH_MEMORY = Object.freeze(['always', 'never']);
/** 阻止本次调用执行的决定。 */
export const APPROVAL_DECISIONS_DENYING = Object.freeze(['reject', 'never', 'timed_out', 'abort']);
//# sourceMappingURL=types.js.map