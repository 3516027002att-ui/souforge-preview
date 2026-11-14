/**
 * Structured identity and version primitives for agent evidence.
 *
 * Evidence identity is deliberately narrower than "all IDs mentioned in a
 * result".  Native/source adapters create these records after they have
 * validated the resource scope; search tickets, scores, offsets and timestamps
 * are never promoted to object identity here.
 */
import { stableJson, utf8CodepointPrefix } from '@soulforge/shared';
export function assertEvidenceText(value, field = 'EVIDENCE_TEXT') {
    if (typeof value !== 'string')
        throw new Error(`INVALID_${field}`);
    return value;
}
function nonEmpty(value, field) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`EMPTY_${field}`);
    }
    return value;
}
function resolvedOuterId(input) {
    return nonEmpty(input.canonicalOuterId ?? input.outerId, 'OUTER_ID');
}
function resolvedObjectHandle(input) {
    return nonEmpty(input.objectHandle ?? input.objectKey ?? input.snapshotObjectHandle, 'OBJECT_HANDLE');
}
function resolvedClaimPart(input) {
    const claim = input.propertyKey ?? input.claimKind ?? input.claimKey;
    if (input.claimKind && input.propertyKey && input.claimKind !== input.propertyKey) {
        return `${input.claimKind}\u0000${input.propertyKey}`;
    }
    return nonEmpty(claim, 'CLAIM_KEY');
}
function scopedNamespace(input) {
    let namespace = nonEmpty(input.namespace, 'NAMESPACE');
    if (input.language !== undefined)
        namespace += `\u0000language=${nonEmpty(input.language, 'LANGUAGE')}`;
    if (input.formatProfileId !== undefined) {
        namespace += `\u0000format=${nonEmpty(input.formatProfileId, 'FORMAT_PROFILE')}`;
    }
    return namespace;
}
export function normalizeEvidenceIdentity(input) {
    const childChain = Array.isArray(input.childChain)
        ? [...input.childChain]
        : [];
    nonEmpty(input.workspaceId, 'WORKSPACE_ID');
    const outerId = resolvedOuterId(input);
    if (childChain.length === 0 || childChain.some((part) => typeof part !== 'string' || part.length === 0)) {
        throw new Error('INVALID_CHILD_CHAIN');
    }
    const objectHandle = resolvedObjectHandle(input);
    const claimPart = resolvedClaimPart(input);
    return {
        workspaceId: input.workspaceId,
        canonicalOuterId: outerId,
        childChain,
        domain: nonEmpty(input.domain, 'DOMAIN'),
        namespace: scopedNamespace(input),
        objectHandle,
        claimKind: claimPart
    };
}
/** Stable, case-preserving claim key. JSON structure avoids delimiter collisions. */
export function evidenceKey(input) {
    const identity = normalizeEvidenceIdentity(input);
    return stableJson([
        identity.workspaceId,
        identity.canonicalOuterId,
        identity.childChain,
        identity.domain,
        identity.namespace,
        identity.objectHandle,
        identity.claimKind
    ]);
}
/** Compatibility name used by the SF-19 smoke/legacy adapter call sites. */
export const makeEvidenceIdentityKey = evidenceKey;
/** Alias used by callers that name the final key explicitly as a claim key. */
export const claimIdentityKey = evidenceKey;
export function evidenceResourceKey(input) {
    const identity = normalizeEvidenceIdentity(input);
    return stableJson([
        identity.workspaceId,
        identity.canonicalOuterId,
        identity.childChain,
        identity.domain,
        identity.namespace
    ]);
}
export const resourceIdentityKey = evidenceResourceKey;
export function normalizeEvidenceVersion(version) {
    if (typeof version === 'string' || typeof version === 'number')
        return { revision: version };
    if (version === undefined)
        return {};
    const normalized = {
        ...(version.revision !== undefined ? { revision: version.revision } : {}),
        ...(version.outerHash !== undefined
            ? { outerHash: version.outerHash }
            : version.sourceHash !== undefined ? { outerHash: version.sourceHash } : {}),
        ...(version.payloadHash !== undefined ? { payloadHash: version.payloadHash } : {}),
        ...(version.readerSchemaHash !== undefined ? { readerSchemaHash: version.readerSchemaHash } : {}),
        ...(version.metadataSchemaHash !== undefined ? { metadataSchemaHash: version.metadataSchemaHash } : {}),
        ...(version.workspaceEpoch !== undefined ? { workspaceEpoch: version.workspaceEpoch } : {})
    };
    return normalized;
}
export function evidenceVersionKey(version) {
    return stableJson(normalizeEvidenceVersion(version));
}
/**
 * Exact version matching. No dictionary ordering is used for revisions: a
 * revision is an opaque host token, and a reader/schema change invalidates the
 * old derived claim even when the bytes/hash are unchanged.
 */
export function evidenceVersionsEqual(left, right) {
    const a = normalizeEvidenceVersion(left);
    const b = normalizeEvidenceVersion(right);
    return evidenceVersionKey(a) === evidenceVersionKey(b);
}
export function evidenceVersionMatchesCurrent(candidate, current) {
    if (current === undefined)
        return false;
    const expected = normalizeEvidenceVersion(current);
    const actual = normalizeEvidenceVersion(candidate);
    // A structured current map is authoritative. Missing fields are not treated
    // as equal because that would let an old reader-schema claim through.
    return Object.keys(expected).every((key) => (Object.prototype.hasOwnProperty.call(actual, key)
        && actual[key] === expected[key]));
}
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function firstString(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.length > 0)
            return value;
        if (typeof value === 'number' && Number.isFinite(value))
            return String(value);
    }
    return undefined;
}
function firstRecordValue(record, keys) {
    for (const key of keys)
        if (record[key] !== undefined)
            return record[key];
    return undefined;
}
function firstVersion(record, parent) {
    const nested = asRecord(record.version);
    const sourceHash = firstString(record, ['sourceHash', 'outerHash']);
    const revision = firstRecordValue(record, ['sourceRevision', 'revision']);
    const readerSchemaHash = firstString(record, ['readerSchemaHash', 'readerSchema']);
    const metadataSchemaHash = firstString(record, ['metadataSchemaHash', 'metadataSchema']);
    const workspaceEpoch = typeof record.workspaceEpoch === 'number' && Number.isSafeInteger(record.workspaceEpoch)
        ? record.workspaceEpoch
        : undefined;
    return {
        ...(parent ?? {}),
        ...(nested ? normalizeEvidenceVersion(nested) : {}),
        ...(sourceHash ? { outerHash: sourceHash } : {}),
        ...(revision !== undefined && (typeof revision === 'string' || typeof revision === 'number')
            ? { revision }
            : {}),
        ...(readerSchemaHash ? { readerSchemaHash } : {}),
        ...(metadataSchemaHash ? { metadataSchemaHash } : {}),
        ...(workspaceEpoch !== undefined ? { workspaceEpoch } : {})
    };
}
function collectionItems(record) {
    for (const key of ['claims', 'fields', 'entries', 'rows', 'events', 'parts', 'entities', 'items', 'hits', 'matches']) {
        if (Array.isArray(record[key]))
            return record[key];
    }
    return [record];
}
const CLAIM_TEXT_MAX_CHARS = 640;
const CLAIM_SUMMARY_KEYS = new Set([
    'sourceUri', 'sourcePath', 'filePath', 'containerPath', 'file', 'uri',
    'eventId', 'rowId', 'textId', 'entityId', 'id', 'mapId', 'paramName',
    'entryName', 'category', 'format', 'resourceKind', 'game', 'restBehavior',
    'instructionCount', 'total', 'offset', 'limit', 'returned', 'truncated',
    'darkScriptComplete', 'crossesBlockBoundary', 'registryOrigin',
    'registryFingerprint', 'sourceHash', 'sourceRevision'
]);
const CLAIM_SUMMARY_ARRAY_KEYS = new Set([
    'instructions', 'fields', 'entries', 'rows', 'events', 'parts', 'entities', 'items', 'hits', 'matches'
]);
function boundedClaimString(value) {
    return value.length <= CLAIM_TEXT_MAX_CHARS
        ? value
        : `${utf8CodepointPrefix(value, CLAIM_TEXT_MAX_CHARS - 1)}…`;
}
/**
 * Build a small semantic fallback for structured claims.  A native event
 * payload can contain the complete DarkScript and hundreds of typed
 * instructions; copying that root JSON into evidence.claims.text duplicates
 * the model-facing data and can consume the entire bridge budget.  Claims are
 * identity/context hints, not a second raw payload, so retain stable scalar
 * facts and bounded collection shape only.
 */
function summarizeClaimRecord(record) {
    const summary = {};
    // Put semantic labels first.  Native event records carry long hashes and
    // paths before their instruction array; iterating the original object order
    // could otherwise consume the bound before the names became visible.
    const instructions = record.instructions;
    if (Array.isArray(instructions)) {
        const names = instructions
            .slice(0, 16)
            .map((item) => item && typeof item === 'object' && !Array.isArray(item)
            ? item.emedfName
            : undefined)
            .filter((name) => typeof name === 'string' && name.length > 0);
        summary.instructions = {
            count: instructions.length,
            names,
            ...(instructions.length > names.length ? { namesTruncated: true } : {})
        };
    }
    for (const [key, value] of Object.entries(record)) {
        if (key === 'instructions')
            continue;
        if (CLAIM_SUMMARY_KEYS.has(key)
            && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
            summary[key] = typeof value === 'string' ? boundedClaimString(value) : value;
            continue;
        }
        if (CLAIM_SUMMARY_ARRAY_KEYS.has(key) && Array.isArray(value)) {
            summary[key] = { count: value.length };
        }
    }
    if (Object.keys(summary).length === 0)
        return 'structured evidence (raw payload retained in tool result)';
    return boundedClaimString(JSON.stringify(summary));
}
function claimText(item, fallback) {
    const value = firstRecordValue(item, ['text', 'value', 'body', 'excerpt', 'summary', 'description']);
    if (typeof value === 'string')
        return boundedClaimString(value);
    if (value !== undefined)
        return boundedClaimString(JSON.stringify(value) ?? String(value));
    if (typeof fallback === 'string')
        return boundedClaimString(fallback);
    return summarizeClaimRecord(item);
}
/**
 * Project a checked native/tool payload into independent typed claims. This is
 * intentionally conservative: if the payload does not expose an explicit
 * workspace, outer resource and object handle, no claim is fabricated.
 */
export function projectEvidenceClaims(payload, options = {}) {
    const root = asRecord(payload);
    if (!root)
        return [];
    const rootIdentity = asRecord(root.identity);
    const rootVersionRecord = asRecord(root.version);
    const parentVersion = firstVersion({ ...root, ...(rootVersionRecord ? { version: rootVersionRecord } : {}) }, undefined);
    const workspaceId = options.workspaceId
        ?? firstString(rootIdentity ?? root, ['workspaceId']);
    const canonicalOuterId = options.canonicalOuterId
        ?? firstString(rootIdentity ?? root, [
            'canonicalOuterId', 'outerId', 'sourceUri', 'sourcePath', 'filePath',
            'containerPath', 'file', 'uri'
        ]);
    const childValue = options.childChain
        ?? firstRecordValue(rootIdentity ?? root, ['childChain']);
    const childChain = Array.isArray(childValue)
        ? childValue.filter((value) => typeof value === 'string' && value.length > 0)
        : (() => {
            const child = firstString(rootIdentity ?? root, ['entryName', 'childId', 'containerEntry']);
            return child ? [child] : ['root'];
        })();
    const domain = options.domain
        ?? firstString(rootIdentity ?? root, ['domain'])
        ?? 'evidence';
    const namespace = options.namespace
        ?? firstString(rootIdentity ?? root, ['namespace', 'paramName', 'table', 'category', 'format', 'resourceKind'])
        ?? domain;
    if (!workspaceId || !canonicalOuterId || childChain.length === 0)
        return [];
    const items = collectionItems(root);
    const claims = [];
    const rootHandle = firstString(rootIdentity ?? root, ['objectHandle', 'objectKey', 'snapshotObjectHandle']);
    for (let index = 0; index < items.length && index < 256; index += 1) {
        const item = asRecord(items[index]);
        if (!item)
            continue;
        const itemIdentity = asRecord(item.identity);
        const record = itemIdentity ? { ...item, ...itemIdentity } : item;
        const objectHandle = firstString(record, ['objectHandle', 'objectKey', 'snapshotObjectHandle'])
            // TAE animation IDs repeat across sections and across sibling events.
            // Its canonical event URI carries both dimensions; a bare animId does not.
            ?? (domain === 'tae' ? firstString(record, ['uri', 'address']) : undefined)
            ?? firstString(record, [
                'objectHandle', 'objectKey', 'snapshotObjectHandle', 'rowId', 'eventId',
                'textId', 'entityId', 'animId', 'id', 'uri', 'address'
            ]) ?? rootHandle;
        if (!objectHandle)
            continue;
        const field = firstString(record, ['propertyKey', 'claimKey', 'claimKind', 'fieldId', 'fieldName', 'name']);
        const claimKind = field ?? (items.length > 1 ? 'object' : 'value');
        const version = firstVersion(record, parentVersion);
        // A container result may contain multiple native children/tables. Root
        // defaults identify their parent, not every field's table or child entry.
        // Without this scope, equal row/field IDs in NpcParam and Bullet collide.
        const itemNamespace = options.namespace
            ?? firstString(record, ['namespace', 'paramName', 'table', 'category', 'format', 'resourceKind'])
            ?? namespace;
        const itemChildValue = firstRecordValue(record, ['childChain']);
        const itemChild = firstString(record, ['entryName', 'childId', 'containerEntry']);
        const itemChildChain = options.childChain
            ?? (Array.isArray(itemChildValue)
                ? itemChildValue
                : itemChild
                    ? childChain.length === 1 && childChain[0] === 'root'
                        ? [itemChild]
                        : childChain[childChain.length - 1] === itemChild
                            ? childChain
                            : [...childChain, itemChild]
                    : childChain);
        const identity = normalizeEvidenceIdentity({
            workspaceId,
            canonicalOuterId,
            childChain: itemChildChain,
            domain,
            namespace: itemNamespace,
            objectHandle,
            claimKind,
            ...(options.language ?? firstString(record, ['language', 'lang'])
                ? { language: options.language ?? firstString(record, ['language', 'lang']) }
                : {}),
            ...(options.formatProfileId ? { formatProfileId: options.formatProfileId } : {})
        });
        const key = evidenceKey(identity);
        claims.push({
            identity,
            key,
            resourceKey: evidenceResourceKey(identity),
            handle: firstString(record, ['handle', 'objectHandle', 'uri']) ?? `${canonicalOuterId}#${objectHandle}`,
            text: claimText(record, root),
            version,
            ...(options.versionState ? { versionState: options.versionState } : {}),
            ...(options.authorityClass ? { authorityClass: options.authorityClass } : {}),
            ...(options.authority !== undefined ? { authority: options.authority } : {}),
            observationSequence: (options.observationSequence ?? 0) + index,
            sequence: (options.observationSequence ?? 0) + index,
            relevance: 0
        });
    }
    return claims;
}
//# sourceMappingURL=evidenceIdentity.js.map