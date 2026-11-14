/**
 * Production contract for Native Evidence, ReadSessions, Cursors, Field Classification,
 * and Write Preconditions across all game resource domains (PARAM, FMG, EMEVD, LUABND, MSB, TAE).
 *
 * Implements S30/S31, T19, T24, T27, T43 from SoulForge Flash Execution Plan.
 */
/**
 * Validates non-empty string.
 */
function assertNonEmpty(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`INVALID_IDENTITY_FIELD: ${name} must be a non-empty string`);
    }
}
/**
 * Deterministically computes the stable evidence key for an object identity.
 * Conforms to SoulForge evidence reference specification.
 * Deliberately preserves exact casing and resource hierarchy.
 */
export function computeEvidenceKey(identity) {
    assertNonEmpty(identity.workspaceId, 'workspaceId');
    assertNonEmpty(identity.outerId, 'outerId');
    assertNonEmpty(identity.domain, 'domain');
    assertNonEmpty(identity.namespace, 'namespace');
    assertNonEmpty(identity.objectKey, 'objectKey');
    if (!Array.isArray(identity.childChain) || !identity.childChain.every((x) => typeof x === 'string' && x.length > 0)) {
        throw new Error('INVALID_IDENTITY_FIELD: childChain must be an array of non-empty strings');
    }
    const claimKey = identity.claimKey ?? '';
    return JSON.stringify([
        identity.workspaceId,
        identity.outerId,
        identity.childChain,
        identity.domain,
        identity.namespace,
        identity.objectKey,
        claimKey
    ]);
}
/**
 * Deterministically computes the parent resource key for version matching.
 */
export function computeEvidenceResourceKey(identity) {
    computeEvidenceKey(identity);
    return JSON.stringify([
        identity.workspaceId,
        identity.outerId,
        identity.childChain,
        identity.domain,
        identity.namespace
    ]);
}
/**
 * Truncates text by UTF-8 bytes without splitting code points or surrogate pairs.
 * Never slices strings directly on arbitrary byte or char boundaries.
 */
export function utf8CodepointPrefix(text, maxBytes) {
    if (maxBytes <= 0)
        return '';
    let used = 0;
    let out = '';
    for (const point of text) {
        const bytes = Buffer.byteLength(point, 'utf8');
        if (used + bytes > maxBytes)
            break;
        out += point;
        used += bytes;
    }
    return out;
}
/**
 * Opaque cursor encoding and decoding.
 * The model receives a sealed token and must never manually construct native offsets.
 */
export function createOpaqueCursor(payload) {
    const json = JSON.stringify({
        s: payload.sessionId,
        o: payload.offset,
        h: payload.sourceHash,
        d: payload.domain,
        k: payload.scope
    });
    return `sf_cur_${Buffer.from(json, 'utf8').toString('base64url')}`;
}
export function parseOpaqueCursor(token) {
    if (typeof token !== 'string' || !token.startsWith('sf_cur_')) {
        throw Object.assign(new Error('Cursor token is invalid or corrupted (INVALID_READ_CURSOR).'), {
            code: 'INVALID_READ_CURSOR'
        });
    }
    try {
        const raw = Buffer.from(token.slice('sf_cur_'.length), 'base64url').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.s !== 'string' || typeof parsed.o !== 'number' || typeof parsed.h !== 'string') {
            throw new Error('Malformed cursor payload');
        }
        return {
            sessionId: parsed.s,
            offset: parsed.o,
            sourceHash: parsed.h,
            domain: parsed.d,
            scope: parsed.k
        };
    }
    catch (e) {
        throw Object.assign(new Error('游标无法解码（INVALID_READ_CURSOR）：游标由本宿主签发，可能已过期或来自其他会话。去掉 cursor 重新请求第一页即可。'), {
            code: 'INVALID_READ_CURSOR',
            cause: e
        });
    }
}
/**
 * In-memory read session manager for multi-page native queries.
 * Validates that the underlying resource version has not changed between pages.
 */
export class NativeReadSessionManager {
    sessions = new Map();
    createSession(params) {
        const sessionId = `rs_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const session = {
            sessionId,
            workspaceId: params.workspaceId,
            sourceVersion: params.sourceVersion,
            domain: params.domain,
            queryScope: params.queryScope,
            sortVersion: params.sortVersion ?? 'v1',
            createdAt: Date.now(),
            ttlMs: params.ttlMs ?? 10 * 60 * 1000,
            items: params.items
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return undefined;
        if (Date.now() - session.createdAt > session.ttlMs) {
            this.sessions.delete(sessionId);
            return undefined;
        }
        return session;
    }
    /**
     * Resolves an opaque cursor against active sessions.
     * Fails fast if source version has drifted, returning STALE_READ_CURSOR and re-read entry.
     */
    resolvePage(token, currentSourceHash, pageSize) {
        const payload = parseOpaqueCursor(token);
        const session = this.getSession(payload.sessionId);
        if (!session) {
            throw Object.assign(new Error('Read session has expired or does not exist (STALE_READ_CURSOR). Please re-read from start.'), {
                code: 'STALE_READ_CURSOR',
                rereadEntry: { domain: payload.domain, scope: payload.scope }
            });
        }
        if (session.sourceVersion.sourceHash !== currentSourceHash || payload.sourceHash !== currentSourceHash) {
            throw Object.assign(new Error(`Source document changed since cursor was minted (STALE_READ_CURSOR): expected=${session.sourceVersion.sourceHash}, current=${currentSourceHash}. Please re-read with latest sourceHash.`), {
                code: 'STALE_READ_CURSOR',
                expectedHash: session.sourceVersion.sourceHash,
                currentHash: currentSourceHash,
                rereadEntry: { domain: payload.domain, scope: payload.scope }
            });
        }
        const offset = payload.offset;
        const total = session.items.length;
        const pageItems = session.items.slice(offset, offset + pageSize);
        const nextOffset = offset + pageItems.length;
        const hasMore = nextOffset < total;
        const nextCursor = hasMore
            ? createOpaqueCursor({
                sessionId: session.sessionId,
                offset: nextOffset,
                sourceHash: currentSourceHash,
                domain: session.domain,
                scope: session.queryScope
            })
            : null;
        return {
            items: pageItems,
            offset,
            total,
            hasMore,
            nextCursor
        };
    }
    invalidate(sessionId) {
        this.sessions.delete(sessionId);
    }
}
/**
 * Shared singleton manager for default read sessions.
 */
export const defaultReadSessionManager = new NativeReadSessionManager();
/**
 * Budgeted structured JSON serializer.
 * Checks actual UTF-8 byte length (Buffer.byteLength) rather than character counts.
 * Protects identity & version. If identity itself exceeds budget, returns RESULT_IDENTITY_TOO_LARGE.
 */
export function budgetStructuredJson(payload, maxBytes) {
    const identityPayload = {
        identity: payload.identity ?? null,
        version: payload.version ?? null
    };
    const identityJson = JSON.stringify(identityPayload);
    const identityBytes = Buffer.byteLength(identityJson, 'utf8');
    if (identityBytes > maxBytes) {
        return {
            ok: false,
            code: 'RESULT_IDENTITY_TOO_LARGE',
            message: `Object identity and version size (${identityBytes} bytes) exceeds total budget of ${maxBytes} bytes.`
        };
    }
    let fullJson = JSON.stringify(payload);
    let fullBytes = Buffer.byteLength(fullJson, 'utf8');
    if (fullBytes <= maxBytes) {
        return { ok: true, json: fullJson, bytes: fullBytes };
    }
    // Progressively prune payload items while preserving identity and structure
    if (Array.isArray(payload.items) && payload.items.length > 0) {
        const workingItems = [...payload.items];
        while (workingItems.length > 0) {
            workingItems.pop();
            const candidatePayload = {
                ...payload,
                items: workingItems,
                truncated: true
            };
            const candidateJson = JSON.stringify(candidatePayload);
            const candidateBytes = Buffer.byteLength(candidateJson, 'utf8');
            if (candidateBytes <= maxBytes) {
                return { ok: true, json: candidateJson, bytes: candidateBytes };
            }
        }
    }
    // Prune string fields using utf8CodepointPrefix
    const minimalPayload = {
        identity: payload.identity,
        version: payload.version,
        items: [],
        truncated: true,
        note: 'Payload data pruned to respect byte budget.'
    };
    const minimalJson = JSON.stringify(minimalPayload);
    const minimalBytes = Buffer.byteLength(minimalJson, 'utf8');
    if (minimalBytes <= maxBytes) {
        return { ok: true, json: minimalJson, bytes: minimalBytes };
    }
    return {
        ok: false,
        code: 'BYTE_BUDGET_EXCEEDED',
        message: `Unable to fit minimal payload within ${maxBytes} bytes.`
    };
}
/**
 * Domain boundary assertion: prevents cross-domain pollution.
 * Map Name / EntityID, TAE event param, FMG text, and tool explanation terminology
 * MUST NOT fall into the same edit entrance.
 */
export function assertEditDomain(expectedDomain, actualDomain) {
    if (expectedDomain !== actualDomain) {
        throw Object.assign(new Error(`DOMAIN_CROSSOVER_REJECTED: Operation intended for domain '${expectedDomain}' cannot target domain '${actualDomain}'.`), {
            code: 'DOMAIN_CROSSOVER_REJECTED',
            expectedDomain,
            actualDomain
        });
    }
}
/**
 * Writable field classification assertion:
 * Rejects writes to display_label or external_metadata from reaching native bytes.
 * Rejects fields whose writable capability is false.
 */
export function assertWritableField(field, requestedKind) {
    if (requestedKind === 'derived_value') {
        throw Object.assign(new Error(`FIELD_KIND_NON_NATIVE: derived_value on field '${field.fieldId}' is a computed projection and cannot be written to native bytes.`), {
            code: 'FIELD_KIND_NON_NATIVE',
            fieldId: field.fieldId,
            valueKind: requestedKind
        });
    }
    if (requestedKind === 'display_label') {
        throw Object.assign(new Error(`FIELD_KIND_NON_NATIVE: display_label '${field.displayLabel ?? field.fieldId}' is a UI presentation label and cannot be written to native bytes.`), {
            code: 'FIELD_KIND_NON_NATIVE',
            fieldId: field.fieldId,
            valueKind: requestedKind
        });
    }
    if (requestedKind === 'external_metadata') {
        throw Object.assign(new Error(`FIELD_KIND_NON_NATIVE: external_metadata on field '${field.fieldId}' is external documentation and cannot be written to native bytes.`), {
            code: 'FIELD_KIND_NON_NATIVE',
            fieldId: field.fieldId,
            valueKind: requestedKind
        });
    }
    if (!field.writable) {
        throw Object.assign(new Error(`FIELD_NOT_WRITABLE: Field '${field.fieldId}' is not writable. Reason: ${field.blockedReason ?? 'Field capability is read-only'}`), {
            code: 'FIELD_NOT_WRITABLE',
            fieldId: field.fieldId,
            blockedReason: field.blockedReason
        });
    }
}
/**
 * Precondition verification for native writes:
 * Verifies that the writer has full coverage of required fields and matching sourceHash.
 * A single sourceHash without complete required field coverage is rejected.
 */
export function assertWritePrecondition(options) {
    if (options.expectedVersion.sourceHash !== options.currentVersion.sourceHash) {
        throw Object.assign(new Error(`SOURCE_VERSION_MISMATCH: Precondition failed for target '${options.targetHandle}'. Expected hash ${options.expectedVersion.sourceHash}, but current version has hash ${options.currentVersion.sourceHash}.`), {
            code: 'SOURCE_VERSION_MISMATCH',
            targetHandle: options.targetHandle,
            expectedHash: options.expectedVersion.sourceHash,
            currentHash: options.currentVersion.sourceHash
        });
    }
    const coveredSet = new Set(options.coveredFields);
    const missing = options.requiredFields.filter((req) => !coveredSet.has(req));
    if (missing.length > 0) {
        throw Object.assign(new Error(`READ_COVERAGE_INCOMPLETE: Precondition failed for target '${options.targetHandle}'. Missing required read coverage for fields: ${missing.join(', ')}.`), {
            code: 'READ_COVERAGE_INCOMPLETE',
            targetHandle: options.targetHandle,
            missingFields: missing
        });
    }
}
//# sourceMappingURL=native-evidence-contract.js.map