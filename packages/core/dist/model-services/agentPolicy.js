import { decideAiToolPermission } from '../ai/toolPermissions.js';
export { DEFAULT_APPROVAL_REQUIRED_LEVELS } from '../../../agent/src/index.mjs';
const SECRET_PATTERNS = [
    /sk-[a-zA-Z0-9_-]{10,}/g,
    /\bBearer\s+[A-Za-z0-9._\-]+/gi,
    // Header inline secrets may appear quoted or bare; the value token class keeps
    // the match anchored to the header keyword so prose cannot false-positive.
    /x-api-key["']?\s*[:=]\s*["']?[A-Za-z0-9._\-]+["']?/gi,
    /api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9._\-]+["']?/gi
];
export function redactSecrets(text) {
    let out = text;
    for (const pattern of SECRET_PATTERNS) {
        out = out.replace(pattern, '[REDACTED]');
    }
    return out;
}
export function assertNoSecretLeak(payload, apiKey) {
    const serialized = JSON.stringify(payload);
    if (apiKey && serialized.includes(apiKey)) {
        throw new Error('MODEL_SERVICE_SECRET_LEAK: audit or DTO payload contains raw API key.');
    }
    // Any remaining secret-shaped text (sk- token, Bearer token, x-api-key: /
    // api_key: inline value) is rejected via the same redaction patterns.
    if (redactSecrets(serialized) !== serialized) {
        throw new Error('MODEL_SERVICE_SECRET_LEAK: payload appears to contain an API key pattern.');
    }
}
const NON_PRODUCTION_PLAN_ALLOW = new Set([
    // fake-loop 与 conformance 自造的只读工具名
    'read_resource',
    'search_workspace',
    'list_diagnostics',
    // testing/harness 的 scaffold typed registry
    'workspace.stats',
    'resource.graph.query',
    'workspace.readFile'
]);
export function isToolAllowedInMode(toolName, mode, registeredTools, 
/** 工具名 → permissionLevel；生产 bridge 会透出该字段。 */
toolLevels) {
    if (!registeredTools.has(toolName)) {
        return {
            ok: false,
            code: 'AGENT_TOOL_NOT_REGISTERED',
            message: `工具 ${toolName} 未在注册表中。`
        };
    }
    const level = toolLevels?.get(toolName);
    if (level === undefined) {
        // 没有等级信息只允许兼容测试构造的只读工具；生产 bridge 一律带等级。
        if (mode === 'plan' && !NON_PRODUCTION_PLAN_ALLOW.has(toolName)) {
            return {
                ok: false,
                code: 'AGENT_TOOL_DENIED_PLAN_MODE',
                message: `计划模式不允许执行工具 ${toolName}(未提供 permissionLevel,`
                    + '且不在已知的非生产只读工具清单里)。'
            };
        }
        return { ok: true };
    }
    const policyMode = mode === 'full' ? 'fullPermission' : mode;
    const decision = decideAiToolPermission(level, policyMode);
    if (!decision.allowed) {
        return {
            ok: false,
            code: mode === 'plan' ? 'AGENT_TOOL_DENIED_PLAN_MODE' : 'AGENT_TOOL_PERMISSION_DENIED',
            message: `工具 ${toolName} 需要 ${decision.required} 权限,`
                + `但 ${decision.mode} 模式上限为 ${decision.ceiling}。`
        };
    }
    return { ok: true };
}
export function extractSwitchedAgentPermissionMode(content) {
    let parsed = content;
    if (typeof content === 'string') {
        try {
            parsed = JSON.parse(content);
        }
        catch {
            return undefined;
        }
    }
    if (!parsed || typeof parsed !== 'object')
        return undefined;
    const root = parsed;
    const envelopeData = root.data && typeof root.data === 'object'
        ? root.data
        : undefined;
    const record = envelopeData?.record && typeof envelopeData.record === 'object'
        ? envelopeData.record
        : undefined;
    const switched = record?.switched ?? envelopeData?.switched ?? root.switched;
    const mode = record?.currentMode ?? envelopeData?.currentMode ?? root.currentMode;
    if (switched !== true || typeof mode !== 'string')
        return undefined;
    if (mode === 'plan' || mode === 'normal')
        return mode;
    if (mode === 'fullPermission' || mode === 'full')
        return 'full';
    if (mode === 'edit')
        return 'normal';
    return undefined;
}
//# sourceMappingURL=agentPolicy.js.map