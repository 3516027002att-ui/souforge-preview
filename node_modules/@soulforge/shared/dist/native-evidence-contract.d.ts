/**
 * Production contract for Native Evidence, ReadSessions, Cursors, Field Classification,
 * and Write Preconditions across all game resource domains (PARAM, FMG, EMEVD, LUABND, MSB, TAE).
 *
 * Implements S30/S31, T19, T24, T27, T43 from SoulForge Flash Execution Plan.
 */
export type NativeEditDomain = 'param' | 'fmg' | 'emevd' | 'script' | 'map' | 'tae';
export type FieldValueKind = 'native_value' | 'derived_value' | 'external_metadata' | 'display_label';
export type NativeReadCompleteness = 'complete' | 'windowed' | 'summary_only' | 'partial';
export type NativeFieldCapability = 'readonly' | 'writable' | 'template_only' | 'blocked';
export interface NativeFieldDescriptor {
    fieldId: string;
    domain: NativeEditDomain;
    valueKind: FieldValueKind;
    nativeType: string;
    width: number;
    nullable: boolean;
    enumSchema?: Record<string, number | string>;
    referenceNamespace?: string;
    /**
     * Writable must be strictly derived from host verified capabilities,
     * never inferred from RAG confidence or LLM guesswork.
     */
    writable: boolean;
    blockedReason?: string;
    requiredReadShape?: string;
    nativeValue?: unknown;
    derivedValue?: unknown;
    externalMetadata?: unknown;
    displayLabel?: string;
}
export interface NativeSourceIdentity {
    workspaceId: string;
    outerId: string;
    childChain: string[];
    domain: NativeEditDomain;
    namespace: string;
    objectKey: string;
    claimKey?: string;
}
export interface NativeSourceVersion {
    sourceUri: string;
    sourceHash: string;
    sourceRevision?: number | string;
}
export interface NativeReadPagination {
    returnedCount: number;
    totalCount: number | null;
    hasMore: boolean;
    nextCursor: string | null;
    missingFields?: string[];
    truncationReason?: string;
    continuationParams?: Record<string, unknown>;
}
export interface NativeReadEnvelope<T = unknown> {
    ok: true;
    state: 'completed';
    objectHandle: string;
    identity: NativeSourceIdentity;
    version: NativeSourceVersion;
    completeness: NativeReadCompleteness;
    fields: NativeFieldDescriptor[];
    capabilities: NativeFieldCapability[];
    pagination: NativeReadPagination;
    data: T;
}
export interface NativeReadSession {
    sessionId: string;
    workspaceId: string;
    sourceVersion: NativeSourceVersion;
    domain: NativeEditDomain;
    queryScope: string;
    sortVersion: string;
    createdAt: number;
    ttlMs: number;
    items: unknown[];
}
export interface CursorPayload {
    sessionId: string;
    offset: number;
    sourceHash: string;
    domain: NativeEditDomain;
    scope: string;
}
/**
 * Deterministically computes the stable evidence key for an object identity.
 * Conforms to SoulForge evidence reference specification.
 * Deliberately preserves exact casing and resource hierarchy.
 */
export declare function computeEvidenceKey(identity: NativeSourceIdentity): string;
/**
 * Deterministically computes the parent resource key for version matching.
 */
export declare function computeEvidenceResourceKey(identity: NativeSourceIdentity): string;
/**
 * Truncates text by UTF-8 bytes without splitting code points or surrogate pairs.
 * Never slices strings directly on arbitrary byte or char boundaries.
 */
export declare function utf8CodepointPrefix(text: string, maxBytes: number): string;
/**
 * Opaque cursor encoding and decoding.
 * The model receives a sealed token and must never manually construct native offsets.
 */
export declare function createOpaqueCursor(payload: CursorPayload): string;
export declare function parseOpaqueCursor(token: string): CursorPayload;
/**
 * In-memory read session manager for multi-page native queries.
 * Validates that the underlying resource version has not changed between pages.
 */
export declare class NativeReadSessionManager {
    private readonly sessions;
    createSession(params: {
        workspaceId: string;
        sourceVersion: NativeSourceVersion;
        domain: NativeEditDomain;
        queryScope: string;
        sortVersion?: string;
        ttlMs?: number;
        items: unknown[];
    }): NativeReadSession;
    getSession(sessionId: string): NativeReadSession | undefined;
    /**
     * Resolves an opaque cursor against active sessions.
     * Fails fast if source version has drifted, returning STALE_READ_CURSOR and re-read entry.
     */
    resolvePage(token: string, currentSourceHash: string, pageSize: number): {
        items: unknown[];
        offset: number;
        total: number;
        hasMore: boolean;
        nextCursor: string | null;
    };
    invalidate(sessionId: string): void;
}
/**
 * Shared singleton manager for default read sessions.
 */
export declare const defaultReadSessionManager: NativeReadSessionManager;
/**
 * Budgeted structured JSON serializer.
 * Checks actual UTF-8 byte length (Buffer.byteLength) rather than character counts.
 * Protects identity & version. If identity itself exceeds budget, returns RESULT_IDENTITY_TOO_LARGE.
 */
export declare function budgetStructuredJson<T extends {
    identity?: unknown;
    version?: unknown;
    items?: unknown[];
}>(payload: T, maxBytes: number): {
    ok: true;
    json: string;
    bytes: number;
} | {
    ok: false;
    code: 'RESULT_IDENTITY_TOO_LARGE' | 'BYTE_BUDGET_EXCEEDED';
    message: string;
};
/**
 * Domain boundary assertion: prevents cross-domain pollution.
 * Map Name / EntityID, TAE event param, FMG text, and tool explanation terminology
 * MUST NOT fall into the same edit entrance.
 */
export declare function assertEditDomain(expectedDomain: NativeEditDomain, actualDomain: NativeEditDomain): void;
/**
 * Writable field classification assertion:
 * Rejects writes to display_label or external_metadata from reaching native bytes.
 * Rejects fields whose writable capability is false.
 */
export declare function assertWritableField(field: NativeFieldDescriptor, requestedKind: FieldValueKind): void;
/**
 * Precondition verification for native writes:
 * Verifies that the writer has full coverage of required fields and matching sourceHash.
 * A single sourceHash without complete required field coverage is rejected.
 */
export declare function assertWritePrecondition(options: {
    targetHandle: string;
    expectedVersion: NativeSourceVersion;
    currentVersion: NativeSourceVersion;
    requiredFields: string[];
    coveredFields: string[];
}): void;
