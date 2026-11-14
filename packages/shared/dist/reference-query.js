/**
 * Unified reference-query contract (执行指令 §3/§4).
 *
 * Everything the Agent, CLI and desktop share for `find_references`:
 * request DTO with a strict decoder, discriminated target selectors, the
 * reference-page record shape, and the certainty/resolution enums.
 *
 * The decoder is the only gate that turns model-authored JSON into a
 * normalized query. It rejects non-safe integers, NaN/Infinity, empty
 * strings, unknown keys and mutually-exclusive target entries BEFORE any
 * reader sees the input. Nested objects are validated field by field —
 * `ToolInputShape` can only describe top-level types.
 */
export const REFERENCE_DEPTH_DEFAULT = 3;
export const REFERENCE_DEPTH_MIN = 1;
export const REFERENCE_DEPTH_MAX = 4;
export const REFERENCE_LIMIT_DEFAULT = 8;
export const REFERENCE_LIMIT_MIN = 1;
export const REFERENCE_LIMIT_MAX = 32;
const QUERY_TOP_LEVEL_KEYS = new Set([
    'uri', 'target', 'query', 'domain', 'direction', 'detail',
    'fieldIds', 'depth', 'limit', 'includeHypotheses', 'cursor', 'sourceCursor'
]);
const SELECTOR_KEYS = {
    objectHandle: new Set(['objectHandle']),
    param: new Set(['domain', 'sourceUri', 'entryIndex', 'entryName', 'rowId', 'rowIndex']),
    emevd: new Set(['domain', 'sourceUri', 'eventId']),
    fmg: new Set(['domain', 'sourceUri', 'childChain', 'category', 'language', 'textId', 'entryIndex']),
    script: new Set(['domain', 'sourceUri', 'childChain', 'scriptEntryIndex']),
    map: new Set(['domain', 'sourceUri', 'nativeObjectKey']),
    tae: new Set(['domain', 'sourceUri', 'childChain', 'taeEntryIndex', 'animId', 'eventIndex']),
    resource: new Set(['domain', 'sourceUri', 'childChain', 'nativeObjectKey'])
};
const REFERENCE_DOMAINS = new Set(['param', 'emevd', 'fmg', 'script', 'map', 'tae', 'resource']);
function failure(code, message, field) {
    return { ok: false, code, message, ...(field ? { field } : {}) };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/** Finite safe integer within [min,max]; rejects Number(''), NaN, Infinity, floats. */
function boundedSafeInteger(value, name, min, max, fallback) {
    if (value === undefined)
        return { ok: true, value: fallback };
    if (typeof value === 'string') {
        // JSON numbers arrive as numbers; a string here is model-authored and must not be coerced.
        return { ok: false, message: `${name} must be a JSON number, not a string.` };
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return { ok: false, message: `${name} must be a safe integer.` };
    }
    if (value < min || value > max) {
        return { ok: false, message: `${name} must be between ${min} and ${max}.` };
    }
    return { ok: true, value };
}
function requiredSafeInteger(value, name) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        return { ok: false, message: `${name} must be a safe integer.` };
    }
    return { ok: true, value };
}
function optionalNonNegativeInteger(value, name) {
    if (value === undefined)
        return { ok: true };
    const parsed = requiredSafeInteger(value, name);
    if (!parsed.ok)
        return parsed;
    if (parsed.value < 0)
        return { ok: false, message: `${name} must be non-negative.` };
    return { ok: true, value: parsed.value };
}
function decodeChildChain(value, name) {
    if (!Array.isArray(value) || value.length === 0) {
        return { ok: false, message: `${name} must be a non-empty array of non-empty strings.` };
    }
    for (const item of value) {
        if (!nonEmptyString(item))
            return { ok: false, message: `${name} entries must be non-empty strings.` };
    }
    return { ok: true, value: [...value] };
}
function failSelector(message) {
    return failure('REFERENCE_INVALID_INPUT', message, 'target');
}
/** Accept the logical URI or the workspace-relative path callers actually pass for one file. */
function normalizeTargetSourceUri(value) {
    const trimmed = value.trim();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(trimmed))
        return trimmed;
    const unified = trimmed.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (/^[A-Za-z]:\//u.test(unified))
        return `file:///${unified}`;
    return `file://${unified.replace(/^\/+/u, '')}`;
}
function decodeTargetSelector(raw) {
    if (!isRecord(raw))
        return failSelector('target must be a structured selector object, not a scalar or array.');
    const keys = Object.keys(raw);
    if (keys.includes('objectHandle')) {
        if (keys.length !== 1)
            return failSelector('objectHandle selector must not carry additional properties.');
        if (!nonEmptyString(raw.objectHandle))
            return failSelector('objectHandle must be a non-empty string.');
        return { ok: true, target: { objectHandle: raw.objectHandle } };
    }
    const domain = raw.domain;
    if (typeof domain !== 'string' || !REFERENCE_DOMAINS.has(domain)) {
        return failSelector(`target.domain must be one of ${[...REFERENCE_DOMAINS].join(', ')}.`);
    }
    const allowed = SELECTOR_KEYS[domain];
    for (const key of keys) {
        if (!allowed.has(key))
            return failSelector(`target.${key} is not a known field for domain '${domain}'.`);
    }
    if (!nonEmptyString(raw.sourceUri))
        return failSelector('target.sourceUri must be a non-empty string.');
    // Callers routinely pass a workspace-relative path ("event/common.emevd.dcx") while the graph keys
    // every node by its logical URI. Without normalization that lookup silently finds nothing and the
    // query looks like "no references exist". Accept both spellings.
    const sourceUri = normalizeTargetSourceUri(raw.sourceUri);
    if (domain === 'param') {
        const entryIndex = optionalNonNegativeInteger(raw.entryIndex, 'entryIndex');
        // entryIndex is required for param: rowIndex-less addressing must still pin the physical entry.
        if (!entryIndex.ok || entryIndex.value === undefined) {
            return failSelector(entryIndex.ok ? 'target.entryIndex is required for param selectors.' : entryIndex.message);
        }
        const rowId = requiredSafeInteger(raw.rowId, 'rowId');
        if (!rowId.ok)
            return failSelector(rowId.message);
        const rowIndex = optionalNonNegativeInteger(raw.rowIndex, 'rowIndex');
        if (!rowIndex.ok)
            return failSelector(rowIndex.message);
        if (raw.entryName !== undefined && !nonEmptyString(raw.entryName))
            return failSelector('entryName must be a non-empty string.');
        return {
            ok: true,
            target: {
                domain, sourceUri,
                entryIndex: entryIndex.value, rowId: rowId.value,
                ...(raw.entryName !== undefined ? { entryName: raw.entryName } : {}),
                ...(rowIndex.value !== undefined ? { rowIndex: rowIndex.value } : {})
            }
        };
    }
    if (domain === 'emevd') {
        const eventId = requiredSafeInteger(raw.eventId, 'eventId');
        if (!eventId.ok)
            return failSelector(eventId.message);
        return { ok: true, target: { domain, sourceUri, eventId: eventId.value } };
    }
    if (domain === 'fmg') {
        const chain = decodeChildChain(raw.childChain, 'childChain');
        if (!chain.ok)
            return failSelector(chain.message);
        if (!nonEmptyString(raw.category))
            return failSelector('category must be a non-empty string.');
        const textId = requiredSafeInteger(raw.textId, 'textId');
        if (!textId.ok)
            return failSelector(textId.message);
        const entryIndex = optionalNonNegativeInteger(raw.entryIndex, 'entryIndex');
        if (!entryIndex.ok)
            return failSelector(entryIndex.message);
        if (raw.language !== undefined && !nonEmptyString(raw.language))
            return failSelector('language must be a non-empty string.');
        return {
            ok: true,
            target: {
                domain, sourceUri, childChain: chain.value,
                category: raw.category, textId: textId.value,
                ...(raw.language !== undefined ? { language: raw.language } : {}),
                ...(entryIndex.value !== undefined ? { entryIndex: entryIndex.value } : {})
            }
        };
    }
    if (domain === 'script') {
        const chain = decodeChildChain(raw.childChain, 'childChain');
        if (!chain.ok)
            return failSelector(chain.message);
        const scriptEntryIndex = optionalNonNegativeInteger(raw.scriptEntryIndex, 'scriptEntryIndex');
        if (!scriptEntryIndex.ok)
            return failSelector(scriptEntryIndex.message);
        return {
            ok: true,
            target: {
                domain, sourceUri, childChain: chain.value,
                ...(scriptEntryIndex.value !== undefined ? { scriptEntryIndex: scriptEntryIndex.value } : {})
            }
        };
    }
    if (domain === 'map') {
        if (!nonEmptyString(raw.nativeObjectKey))
            return failSelector('nativeObjectKey must be a non-empty string.');
        return { ok: true, target: { domain, sourceUri, nativeObjectKey: raw.nativeObjectKey } };
    }
    if (domain === 'tae') {
        const chain = decodeChildChain(raw.childChain, 'childChain');
        if (!chain.ok)
            return failSelector(chain.message);
        const taeEntryIndex = optionalNonNegativeInteger(raw.taeEntryIndex, 'taeEntryIndex');
        if (!taeEntryIndex.ok || taeEntryIndex.value === undefined) {
            return failSelector(taeEntryIndex.ok ? 'taeEntryIndex is required for tae selectors.' : taeEntryIndex.message);
        }
        const animId = requiredSafeInteger(raw.animId, 'animId');
        if (!animId.ok)
            return failSelector(animId.message);
        const eventIndex = optionalNonNegativeInteger(raw.eventIndex, 'eventIndex');
        if (!eventIndex.ok)
            return failSelector(eventIndex.message);
        return {
            ok: true,
            target: {
                domain, sourceUri, childChain: chain.value,
                taeEntryIndex: taeEntryIndex.value, animId: animId.value,
                ...(eventIndex.value !== undefined ? { eventIndex: eventIndex.value } : {})
            }
        };
    }
    // resource
    const chain = decodeChildChain(raw.childChain, 'childChain');
    if (!chain.ok)
        return failSelector(chain.message);
    if (raw.nativeObjectKey !== undefined && !nonEmptyString(raw.nativeObjectKey)) {
        return failSelector('nativeObjectKey must be a non-empty string.');
    }
    return {
        ok: true,
        target: {
            domain: 'resource', sourceUri, childChain: chain.value,
            ...(raw.nativeObjectKey !== undefined ? { nativeObjectKey: raw.nativeObjectKey } : {})
        }
    };
}
/**
 * Strict decode of a model-authored `find_references` argument object.
 *
 * First requests must carry exactly one of uri / target / query.
 * Cursor continuations must not re-declare a target entry (host compares the
 * remaining scope against the stored query and rejects mismatches).
 */
export function decodeReferenceQueryInput(raw) {
    if (!isRecord(raw)) {
        return failure('REFERENCE_INVALID_INPUT', 'find_references arguments must be a JSON object.');
    }
    for (const key of Object.keys(raw)) {
        if (!QUERY_TOP_LEVEL_KEYS.has(key)) {
            return failure('REFERENCE_INVALID_INPUT', `Unknown find_references argument '${key}'.`, key);
        }
    }
    const hasUri = raw.uri !== undefined;
    const hasTarget = raw.target !== undefined;
    const hasQuery = raw.query !== undefined;
    const hasCursor = nonEmptyString(raw.cursor);
    const hasSourceCursor = nonEmptyString(raw.sourceCursor);
    if (raw.cursor !== undefined && !hasCursor) {
        return failure('REFERENCE_INVALID_INPUT', 'cursor must be a non-empty string.', 'cursor');
    }
    if (hasCursor) {
        if (hasUri || hasTarget || hasQuery || hasSourceCursor) {
            return failure('REFERENCE_CURSOR_SCOPE_MISMATCH', 'A result cursor continuation must not re-declare uri/target/query/sourceCursor; omit them or start a fresh query.');
        }
    }
    else {
        const entries = [hasUri, hasTarget, hasQuery].filter(Boolean).length;
        if (entries === 0) {
            return failure('REFERENCE_TARGET_REQUIRED', 'find_references requires exactly one of uri, target or query.');
        }
        if (entries > 1) {
            return failure('REFERENCE_TARGET_CONFLICT', 'uri, target and query are mutually exclusive; provide exactly one.');
        }
    }
    const normalized = {
        direction: 'both',
        detail: 'context',
        depth: REFERENCE_DEPTH_DEFAULT,
        limit: REFERENCE_LIMIT_DEFAULT,
        includeHypotheses: false,
        cursorScopeCheckRequired: hasCursor
    };
    if (hasUri) {
        if (!nonEmptyString(raw.uri))
            return failure('REFERENCE_INVALID_INPUT', 'uri must be a non-empty string.', 'uri');
        normalized.uri = raw.uri.trim();
    }
    if (hasQuery) {
        if (!nonEmptyString(raw.query))
            return failure('REFERENCE_INVALID_INPUT', 'query must be a non-empty string.', 'query');
        normalized.query = raw.query.trim();
    }
    if (raw.sourceCursor !== undefined) {
        if (!hasSourceCursor)
            return failure('REFERENCE_INVALID_INPUT', 'sourceCursor must be a non-empty string.', 'sourceCursor');
        if (!hasUri && !hasTarget && !hasQuery) {
            return failure('REFERENCE_TARGET_REQUIRED', 'sourceCursor 只能附着在带 uri、target 或 query 的新查询上。', 'sourceCursor');
        }
        normalized.sourceCursor = raw.sourceCursor.trim();
    }
    if (hasTarget) {
        const decoded = decodeTargetSelector(raw.target);
        if (!decoded.ok)
            return decoded;
        normalized.target = decoded.target;
    }
    if (raw.domain !== undefined) {
        if (!nonEmptyString(raw.domain))
            return failure('REFERENCE_INVALID_INPUT', 'domain must be a non-empty string.', 'domain');
        if (!normalized.query) {
            return failure('REFERENCE_INVALID_INPUT', 'domain only qualifies a query; it cannot narrow uri or target.', 'domain');
        }
        normalized.domain = raw.domain.trim();
    }
    if (raw.direction !== undefined) {
        if (raw.direction !== 'from' && raw.direction !== 'to' && raw.direction !== 'both') {
            return failure('REFERENCE_INVALID_INPUT', 'direction must be from, to or both.', 'direction');
        }
        normalized.direction = raw.direction;
    }
    if (raw.detail !== undefined) {
        if (raw.detail !== 'edges' && raw.detail !== 'context') {
            return failure('REFERENCE_INVALID_INPUT', 'detail must be edges or context.', 'detail');
        }
        normalized.detail = raw.detail;
    }
    if (raw.fieldIds !== undefined) {
        if (!Array.isArray(raw.fieldIds) || raw.fieldIds.length === 0) {
            return failure('REFERENCE_INVALID_INPUT', 'fieldIds must be a non-empty array when provided; an empty array is not a whole-table read.', 'fieldIds');
        }
        if (!normalized.target || !('domain' in normalized.target) || normalized.target.domain !== 'param') {
            return failure('REFERENCE_INVALID_INPUT', 'fieldIds is only valid on a param root target.', 'fieldIds');
        }
        for (const item of raw.fieldIds) {
            if (!nonEmptyString(item))
                return failure('REFERENCE_INVALID_INPUT', 'fieldIds entries must be non-empty strings.', 'fieldIds');
        }
        normalized.fieldIds = [...raw.fieldIds];
    }
    const depth = boundedSafeInteger(raw.depth, 'depth', REFERENCE_DEPTH_MIN, REFERENCE_DEPTH_MAX, REFERENCE_DEPTH_DEFAULT);
    if (!depth.ok)
        return failure('REFERENCE_INVALID_INPUT', depth.message, 'depth');
    normalized.depth = depth.value;
    const limit = boundedSafeInteger(raw.limit, 'limit', REFERENCE_LIMIT_MIN, REFERENCE_LIMIT_MAX, REFERENCE_LIMIT_DEFAULT);
    if (!limit.ok)
        return failure('REFERENCE_INVALID_INPUT', limit.message, 'limit');
    normalized.limit = limit.value;
    if (raw.includeHypotheses !== undefined) {
        if (typeof raw.includeHypotheses !== 'boolean') {
            return failure('REFERENCE_INVALID_INPUT', 'includeHypotheses must be a boolean.', 'includeHypotheses');
        }
        normalized.includeHypotheses = raw.includeHypotheses;
    }
    if (hasCursor)
        normalized.cursor = raw.cursor.trim();
    return { ok: true, input: normalized };
}
//# sourceMappingURL=reference-query.js.map