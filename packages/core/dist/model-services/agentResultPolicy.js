/** Normalize failure text without treating request failure as a transaction outcome. */
import { redactSecrets } from './agentPolicy.js';
export function canonicalizeToolFailureContent(result) {
    if (result.ok)
        return redactSecrets(result.content);
    let parsed;
    try {
        parsed = JSON.parse(result.content);
    }
    catch {
        parsed = undefined;
    }
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : undefined;
    const existingError = record?.error && typeof record.error === 'object' && !Array.isArray(record.error)
        ? record.error
        : {};
    const code = typeof existingError.code === 'string' && existingError.code.trim() !== ''
        ? existingError.code
        : typeof record?.code === 'string' && record.code.trim() !== ''
            ? record.code
            : result.code ?? 'TOOL_EXECUTION_FAILED';
    const message = typeof existingError.message === 'string' && existingError.message.trim() !== ''
        ? existingError.message.trim().slice(0, 1_000)
        : typeof record?.message === 'string' && record.message.trim() !== ''
            ? record.message.trim().slice(0, 1_000)
            : result.content.trim().slice(0, 1_000) || `工具 ${code} 执行失败。`;
    const nestedDetails = existingError.details && typeof existingError.details === 'object'
        && !Array.isArray(existingError.details)
        ? existingError.details
        : undefined;
    const legacyDetails = record?.details && typeof record.details === 'object'
        && !Array.isArray(record.details)
        ? record.details
        : undefined;
    const details = nestedDetails ?? legacyDetails;
    return redactSecrets(JSON.stringify({
        ok: false,
        state: 'failed',
        error: {
            code,
            message,
            ...(details ? { details } : {})
        }
    }));
}
export function failureCodeFromContent(content) {
    try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return undefined;
        const error = parsed.error;
        if (!error || typeof error !== 'object' || Array.isArray(error))
            return undefined;
        const code = error.code;
        return typeof code === 'string' && code.trim() !== '' ? code : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=agentResultPolicy.js.map