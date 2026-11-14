import { createHash } from 'node:crypto';
import { RAG_CHUNK_FAMILIES } from '@soulforge/shared';
import { compareCodePointText } from './topK.js';
export class RetrievalScopeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'RetrievalScopeError';
        this.code = code;
    }
}
/**
 * Normalize the one scope used by lexical lookup, vector lookup, exact
 * matching, and reference expansion.  The array overload mirrors the small
 * reference algorithm and is useful for direct algorithm tests.
 */
export function normalizeRetrievalScope(input, authorization, expectedWorkspaceId) {
    const value = input ?? {};
    const outer = Array.isArray(authorization)
        ? { workspaceId: expectedWorkspaceId ?? value.workspaceId ?? '', families: authorization }
        : authorization;
    const hostWorkspaceId = expectedWorkspaceId ?? outer?.workspaceId ?? value.workspaceId;
    const workspaceId = nonEmptyString(hostWorkspaceId, 'INVALID_SCOPE_WORKSPACE');
    if (value.workspaceId !== undefined && value.workspaceId !== workspaceId) {
        throw new RetrievalScopeError('INVALID_SCOPE_WORKSPACE', '检索 scope 的 workspaceId 不能扩大或改写宿主注入的工作区身份。');
    }
    const allFamilies = [...(outer?.families ?? RAG_CHUNK_FAMILIES)];
    const allowedFamilies = new Set();
    for (const family of allFamilies) {
        if (!RAG_CHUNK_FAMILIES.includes(family)) {
            throw new RetrievalScopeError('INVALID_FAMILY_FILTER', `授权 family 不受支持：${String(family)}`);
        }
        allowedFamilies.add(family);
    }
    const families = normalizeFamilies(value.families, allowedFamilies);
    const resourceUris = normalizeOptionalSet(mergeAliases(value.resourceUris, value.sourceUris), outer?.resourceUris, 'INVALID_RESOURCE_FILTER');
    const resourceKinds = normalizeOptionalSet(value.resourceKinds ?? (value.resourceKind ? [value.resourceKind] : undefined), outer?.resourceKinds, 'INVALID_RESOURCE_FILTER');
    const relativePaths = normalizeOptionalSet(value.relativePaths, outer?.relativePaths, 'INVALID_RESOURCE_FILTER');
    const sourceUriPrefixes = normalizeOptionalStrings(mergeAliases(value.sourceUriPrefixes, value.resourceUriPrefixes), outer?.sourceUriPrefixes, 'INVALID_RESOURCE_FILTER');
    const game = normalizeScopedString(value.game, outer?.game, 'INVALID_SCOPE_GAME');
    const profile = normalizeScopedString(value.profile, outer?.profile, 'INVALID_SCOPE_PROFILE');
    const language = normalizeScopedString(value.language, outer?.language, 'INVALID_SCOPE_LANGUAGE');
    const revisions = normalizeRevisions(value, outer);
    if (value.allowStale === true || (value.stalePolicy !== undefined && value.stalePolicy !== 'exclude')) {
        throw new RetrievalScopeError('INVALID_STALE_POLICY', 'RAG 检索 scope 不允许放行 stale 证据。');
    }
    const normalized = {
        workspaceId,
        families,
        ...(resourceUris ? { resourceUris } : {}),
        ...(resourceKinds ? { resourceKinds } : {}),
        ...(relativePaths ? { relativePaths } : {}),
        ...(sourceUriPrefixes ? { sourceUriPrefixes } : {}),
        ...(game ? { game } : {}),
        ...(profile ? { profile } : {}),
        ...(language ? { language } : {}),
        ...(revisions.revision !== undefined ? { revision: revisions.revision } : {}),
        ...(revisions.revisions ? { revisions: revisions.revisions } : {}),
        stalePolicy: 'exclude',
        ...(value.readerSchema !== undefined ? { readerSchema: nonEmptyString(value.readerSchema, 'INVALID_SCHEMA') } : {}),
        ...(value.metadataSchema !== undefined ? { metadataSchema: nonEmptyString(value.metadataSchema, 'INVALID_SCHEMA') } : {}),
        ...(value.embeddingModel !== undefined ? { embeddingModel: nonEmptyString(value.embeddingModel, 'INVALID_EMBEDDING_MODEL') } : {}),
        ...(value.embeddingProfile !== undefined ? { embeddingProfile: nonEmptyString(value.embeddingProfile, 'INVALID_EMBEDDING_PROFILE') } : {}),
        ...(value.corpusRevision !== undefined ? { corpusRevision: nonEmptyString(value.corpusRevision, 'INVALID_CORPUS_REVISION') } : {})
    };
    return { ...normalized, key: scopeKey(normalized) };
}
/** Short alias retained for callers that mirror the reference algorithm. */
export const normalizeScope = normalizeRetrievalScope;
/** The one hard predicate shared by every retrieval branch. */
export function isChunkEligible(chunk, scope) {
    if (chunk.workspaceId !== scope.workspaceId)
        return false;
    if (!scope.families.has(chunk.family))
        return false;
    const record = chunk;
    if (record.stale === true || record.isStale === true || record.staleState === 'stale')
        return false;
    const chunkRevision = chunkRevisionOf(chunk);
    if (scope.revision !== undefined && chunkRevision !== scope.revision)
        return false;
    if (scope.revisions && (chunkRevision === undefined || !scope.revisions.has(chunkRevision)))
        return false;
    if (scope.resourceUris
        && !scope.resourceUris.has(chunk.sourceUri)
        && !scope.resourceUris.has(chunk.symbolUri))
        return false;
    if (scope.resourceKinds && (!chunk.resourceKind || !scope.resourceKinds.has(chunk.resourceKind)))
        return false;
    if (scope.relativePaths && (!chunk.relativePath || !scope.relativePaths.has(chunk.relativePath)))
        return false;
    if (scope.sourceUriPrefixes && !scope.sourceUriPrefixes.some((prefix) => chunk.sourceUri.startsWith(prefix)))
        return false;
    if (scope.game !== undefined && readString(record, ['game', 'gameId']) !== scope.game)
        return false;
    if (scope.profile !== undefined
        && readString(record, ['profile', 'formatProfile', 'metadataProfile', 'embeddingProfile']) !== scope.profile)
        return false;
    if (scope.language !== undefined && readString(record, ['language', 'locale']) !== scope.language)
        return false;
    return true;
}
/** Short alias retained for direct algorithm tests. */
export const eligible = isChunkEligible;
export function chunkRevisionOf(chunk) {
    if (chunk.sourceRevision !== undefined)
        return chunk.sourceRevision;
    const record = chunk;
    const revision = record.revision;
    return typeof revision === 'string' || (typeof revision === 'number' && Number.isFinite(revision))
        ? revision
        : undefined;
}
export function retrievalCandidateLimit(finalLimit) {
    if (!Number.isSafeInteger(finalLimit) || finalLimit < 1 || finalLimit > 32) {
        throw new RetrievalScopeError('INVALID_LIMIT', 'finalLimit 必须是 1..32 的安全整数。');
    }
    return Math.min(256, Math.max(64, 4 * finalLimit));
}
export function corpusRevision(corpus) {
    const hash = createHash('sha256');
    hash.update(corpus.workspaceId);
    hash.update('\u0000');
    hash.update(corpus.builtAt);
    for (const chunk of [...corpus.chunks].sort((left, right) => compareCodePointText(left.chunkId, right.chunkId))) {
        hash.update(JSON.stringify([
            chunk.chunkId,
            chunk.workspaceId,
            chunk.sourceUri,
            chunk.symbolUri,
            chunk.family,
            chunk.contentHash,
            chunk.outerFileHash ?? null,
            chunk.sourceHash ?? null,
            chunk.sourceRevision ?? null
        ]));
        hash.update('\n');
    }
    const orderedReferences = corpus.references
        .map((edge, index) => ({ index, key: edgeKey(edge) }))
        .sort((left, right) => compareCodePointText(left.key, right.key) || left.index - right.index);
    for (const reference of orderedReferences) {
        hash.update(reference.key);
        hash.update('\n');
    }
    return hash.digest('hex');
}
// This cache is deliberately guarded by the lookup object and both mutable
// signatures.  A corpus object may be edited in place, so a corpus-only
// WeakMap hit would turn a stale revision into a valid cache key.
const corpusRevisionCache = new WeakMap();
/**
 * Return a canonical revision after the caller has completed ensureLookupIndex
 * validation.  The same helper also warms the revision cache during async index
 * publication, so the first retrieval does not pay the canonical sort cost.
 */
export function corpusRevisionForValidatedLookup(corpus, lookup) {
    const cached = corpusRevisionCache.get(corpus);
    if (cached
        && cached.lookup === lookup
        && cached.chunkSignature === lookup.chunkSignature
        && cached.referenceSignature === lookup.referenceSignature
        && cached.workspaceId === corpus.workspaceId
        && cached.builtAt === corpus.builtAt) {
        return cached.revision;
    }
    const revision = corpusRevision(corpus);
    corpusRevisionCache.set(corpus, {
        lookup,
        chunkSignature: lookup.chunkSignature,
        referenceSignature: lookup.referenceSignature,
        workspaceId: corpus.workspaceId,
        builtAt: corpus.builtAt,
        revision
    });
    return revision;
}
export function retrievalCacheKey(input) {
    return JSON.stringify({
        query: input.query.trim().normalize('NFC').toLowerCase(),
        scope: input.scope.key,
        corpusRevision: input.corpusRevision,
        readerSchema: input.readerSchema ?? input.scope.readerSchema ?? null,
        metadataSchema: input.metadataSchema ?? input.scope.metadataSchema ?? null,
        embeddingModel: input.embeddingModel ?? input.scope.embeddingModel ?? null,
        embeddingProfile: input.embeddingProfile ?? input.scope.embeddingProfile ?? null,
        limit: input.limit,
        candidateLimit: input.candidateLimit,
        excerptChars: input.excerptChars,
        expandReferences: input.expandReferences,
        excludeSourceUris: input.excludeSourceUris
            ? [...new Set(input.excludeSourceUris.map(normalizeSourceIdentity).filter(Boolean))].sort()
            : [],
        excludeChunkMaskKey: input.excludeChunkMaskKey ?? null,
        excludeChunkIds: input.excludeChunkMaskKey === undefined && input.excludeChunkIds
            ? [...new Set(input.excludeChunkIds.filter((chunkId) => chunkId.trim().length > 0))].sort()
            : [],
        mode: input.mode ?? 'lexical'
    });
}
const retrievalCache = new Map();
export function getRetrievalCache(key) {
    return retrievalCache.get(key)?.result;
}
export function setRetrievalCache(key, workspaceId, result) {
    retrievalCache.set(key, { workspaceId, result });
}
/** Source or schema refreshes invalidate the whole workspace query cache. */
export function invalidateRetrievalCache(workspaceId) {
    for (const [key, entry] of retrievalCache) {
        if (entry.workspaceId === workspaceId)
            retrievalCache.delete(key);
    }
}
export function clearRetrievalCache() {
    retrievalCache.clear();
}
function normalizeFamilies(requested, allowed) {
    if (requested === undefined)
        return new Set(allowed);
    if (!Array.isArray(requested) || requested.length === 0) {
        throw new RetrievalScopeError('INVALID_FAMILY_FILTER', 'families 显式为空时拒绝放大为全量 family。');
    }
    const selected = new Set();
    for (const family of requested) {
        if (typeof family !== 'string' || !RAG_CHUNK_FAMILIES.includes(family) || !allowed.has(family)) {
            throw new RetrievalScopeError('INVALID_FAMILY_FILTER', `检索 scope 包含未授权或未知 family：${String(family)}`);
        }
        selected.add(family);
    }
    return selected;
}
function normalizeSourceIdentity(value) {
    return value
        .trim()
        .replaceAll('\\', '/')
        .replace(/^file:\/\//iu, '')
        .replace(/\/+/gu, '/')
        .toLocaleLowerCase();
}
function normalizeOptionalSet(requested, authorized, code) {
    if (requested !== undefined && (!Array.isArray(requested) || requested.length === 0)) {
        throw new RetrievalScopeError(code, '资源范围显式为空时拒绝扩大检索范围。');
    }
    const requestedSet = requested === undefined ? undefined : new Set(requested.map((value) => nonEmptyString(value, code)));
    const authorizedSet = authorized === undefined ? undefined : new Set(authorized.map((value) => nonEmptyString(value, code)));
    if (requestedSet && authorizedSet) {
        for (const value of requestedSet) {
            if (!authorizedSet.has(value))
                throw new RetrievalScopeError(code, `资源不在宿主授权范围内：${value}`);
        }
    }
    return requestedSet ?? authorizedSet;
}
function normalizeOptionalStrings(requested, authorized, code) {
    if (requested !== undefined && (!Array.isArray(requested) || requested.length === 0)) {
        throw new RetrievalScopeError(code, '资源前缀范围显式为空。');
    }
    const values = requested ?? authorized;
    if (values === undefined)
        return undefined;
    const normalized = [...new Set(values.map((value) => nonEmptyString(value, code)))];
    if (requested && authorized) {
        for (const prefix of normalized) {
            if (!authorized.some((allowed) => prefix.startsWith(allowed))) {
                throw new RetrievalScopeError(code, `资源前缀不在宿主授权范围内：${prefix}`);
            }
        }
    }
    return normalized.sort(compareCodePointText);
}
function normalizeScopedString(requested, authorized, code) {
    if (requested !== undefined) {
        const value = nonEmptyString(requested, code);
        if (authorized !== undefined && value !== authorized) {
            throw new RetrievalScopeError(code, `scope 值超出宿主授权范围：${value}`);
        }
        return value;
    }
    return authorized === undefined ? undefined : nonEmptyString(authorized, code);
}
function normalizeRevisions(input, authorization) {
    if (input.revision !== undefined && input.revisions !== undefined) {
        throw new RetrievalScopeError('INVALID_REVISION_FILTER', 'revision 与 revisions 不能同时指定。');
    }
    const authorizedRevisions = authorization?.revisions;
    const requested = input.revisions ?? (input.revision !== undefined ? [input.revision] : undefined);
    if (requested !== undefined && (!Array.isArray(requested) || requested.length === 0)) {
        throw new RetrievalScopeError('INVALID_REVISION_FILTER', '版本范围不能为空。');
    }
    const values = requested?.map((value) => normalizeVersion(value))
        ?? authorizedRevisions?.map((value) => normalizeVersion(value));
    if (values) {
        const set = new Set(values);
        if (authorizedRevisions) {
            const allowed = new Set(authorizedRevisions.map((value) => normalizeVersion(value)));
            for (const value of set) {
                if (!allowed.has(value))
                    throw new RetrievalScopeError('INVALID_REVISION_FILTER', `版本不在宿主授权范围内：${String(value)}`);
            }
        }
        if (set.size === 1) {
            const revision = [...set][0];
            if (revision === undefined)
                throw new RetrievalScopeError('INVALID_REVISION_FILTER', '版本范围为空。');
            return { revision };
        }
        return { revisions: set };
    }
    if (authorization?.revision !== undefined)
        return { revision: normalizeVersion(authorization.revision) };
    return {};
}
function normalizeVersion(value) {
    if (typeof value === 'string')
        return nonEmptyString(value, 'INVALID_REVISION_FILTER');
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    throw new RetrievalScopeError('INVALID_REVISION_FILTER', '版本必须是非空字符串或有限数字。');
}
function mergeAliases(first, second) {
    if (first === undefined)
        return second;
    if (second === undefined)
        return first;
    return [...first, ...second];
}
function scopeKey(scope) {
    return JSON.stringify({
        workspaceId: scope.workspaceId,
        families: [...scope.families].sort(compareCodePointText),
        resourceUris: scope.resourceUris ? [...scope.resourceUris].sort(compareCodePointText) : null,
        resourceKinds: scope.resourceKinds ? [...scope.resourceKinds].sort(compareCodePointText) : null,
        relativePaths: scope.relativePaths ? [...scope.relativePaths].sort(compareCodePointText) : null,
        sourceUriPrefixes: scope.sourceUriPrefixes ?? null,
        game: scope.game ?? null,
        profile: scope.profile ?? null,
        language: scope.language ?? null,
        revision: scope.revision ?? null,
        revisions: scope.revisions ? [...scope.revisions].sort(compareVersion) : null,
        stalePolicy: scope.stalePolicy,
        readerSchema: scope.readerSchema ?? null,
        metadataSchema: scope.metadataSchema ?? null,
        embeddingModel: scope.embeddingModel ?? null,
        embeddingProfile: scope.embeddingProfile ?? null,
        corpusRevision: scope.corpusRevision ?? null
    });
}
function readString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string')
            return value;
    }
    return undefined;
}
function edgeKey(edge) {
    return JSON.stringify([edge.fromUri, edge.toUri, edge.kind, edge.confidence, edge.reason ?? '']);
}
function nonEmptyString(value, code) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new RetrievalScopeError(code, 'scope 字段必须是非空字符串。');
    }
    return value.trim();
}
function compareVersion(left, right) {
    if (typeof left === 'number' && typeof right === 'number')
        return left - right;
    return compareCodePointText(String(left), String(right));
}
//# sourceMappingURL=retrievalScope.js.map