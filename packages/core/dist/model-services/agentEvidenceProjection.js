import { evidenceKey, evidenceResourceKey } from './evidenceSelection.js';
import { normalizeEvidenceVersion } from './evidenceIdentity.js';
import { expandEvidenceClaims } from './evidenceTransport.js';
function evidenceCandidatesFromToolContent(content) {
    try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return [];
        const evidence = parsed.evidence;
        if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
            return [];
        const claims = expandEvidenceClaims(evidence);
        const output = [];
        for (const value of claims) {
            if (!value || typeof value !== 'object' || Array.isArray(value))
                continue;
            const candidate = value;
            const identity = candidate.identity;
            const version = candidate.version;
            if (!identity || typeof identity !== 'object' || Array.isArray(identity)
                || typeof candidate.handle !== 'string'
                || typeof candidate.text !== 'string'
                || (version !== undefined
                    && version !== null
                    && typeof version !== 'string'
                    && typeof version !== 'number'
                    && (typeof version !== 'object' || Array.isArray(version))))
                continue;
            const claim = candidate;
            try {
                // Requiredness is host-plan state, so model/tool payloads cannot seed it.
                const normalizedVersion = normalizeEvidenceVersion((version ?? {}));
                output.push({
                    ...claim,
                    key: evidenceKey(claim.identity),
                    resourceKey: evidenceResourceKey(claim.identity),
                    version: normalizedVersion,
                    required: false
                });
            }
            catch {
                // Invalid or incomplete claims remain in the raw transcript but do not
                // enter the structured evidence queue.
            }
        }
        return output;
    }
    catch {
        return [];
    }
}
export function makeToolEvidenceSource(toolName, content, meta, allowStructuredClaims = false) {
    const claims = allowStructuredClaims ? evidenceCandidatesFromToolContent(content) : [];
    return {
        kind: 'toolResult',
        uri: toolName,
        text: content,
        ...(meta ? { meta } : {}),
        ...(claims.length > 0 ? { evidenceCandidates: claims } : {})
    };
}
export function envelopeKnowledgeRefreshStatus(content) {
    try {
        const root = JSON.parse(content);
        const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
            ? root.data
            : undefined;
        const record = data?.record && typeof data.record === 'object' && !Array.isArray(data.record)
            ? data.record
            : undefined;
        const candidates = [
            record?.lifecycle,
            record?.knowledgeRefresh,
            data?.lifecycle,
            data?.knowledgeRefresh,
            root.lifecycle,
            root.knowledgeRefresh
        ];
        const readStatus = (candidate, depth = 0) => {
            if (depth > 3 || candidate === null || candidate === undefined)
                return undefined;
            if (typeof candidate === 'string') {
                const status = candidate.trim();
                return status.length > 0 ? status : undefined;
            }
            if (typeof candidate !== 'object' || Array.isArray(candidate))
                return undefined;
            const value = candidate;
            const nested = readStatus(value.knowledgeRefresh, depth + 1);
            if (nested !== undefined)
                return nested;
            return readStatus(value.status, depth + 1);
        };
        for (const candidate of candidates) {
            const status = readStatus(candidate);
            if (status !== undefined)
                return status;
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export function isHealthyKnowledgeRefreshStatus(status) {
    return status === 'completed' || status === 'converged' || status === 'preserved' || status === 'not_requested';
}
//# sourceMappingURL=agentEvidenceProjection.js.map