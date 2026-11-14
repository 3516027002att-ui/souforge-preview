/**
 * Structured identity and version primitives for agent evidence.
 *
 * Evidence identity is deliberately narrower than "all IDs mentioned in a
 * result".  Native/source adapters create these records after they have
 * validated the resource scope; search tickets, scores, offsets and timestamps
 * are never promoted to object identity here.
 */
export type EvidenceRevision = number | string;
export interface EvidenceIdentity {
    readonly workspaceId: string;
    readonly canonicalOuterId: string;
    readonly childChain: readonly string[];
    readonly domain: string;
    readonly namespace: string;
    readonly objectHandle: string;
    /** Use one of claimKind/propertyKey/claimKey for the final claim component. */
    readonly claimKind?: string;
    readonly propertyKey?: string;
    readonly claimKey?: string;
    /** Optional source dimensions are folded into namespace without changing the key shape. */
    readonly language?: string;
    readonly formatProfileId?: string;
}
export interface EvidenceVersion {
    readonly revision?: EvidenceRevision;
    readonly sourceHash?: string;
    readonly outerHash?: string;
    readonly payloadHash?: string | null;
    readonly readerSchemaHash?: string;
    readonly metadataSchemaHash?: string;
    readonly workspaceEpoch?: number;
}
export interface EvidenceIdentityInput {
    readonly workspaceId: string;
    readonly canonicalOuterId?: string;
    readonly outerId?: string;
    readonly childChain: readonly string[];
    readonly domain: string;
    readonly namespace: string;
    readonly objectHandle?: string;
    readonly objectKey?: string;
    readonly snapshotObjectHandle?: string;
    readonly claimKind?: string;
    readonly propertyKey?: string;
    readonly claimKey?: string;
    readonly language?: string;
    readonly formatProfileId?: string;
}
export interface EvidenceClaim {
    readonly identity: EvidenceIdentity;
    readonly key: string;
    readonly resourceKey: string;
    readonly handle: string;
    readonly text: string;
    readonly version: EvidenceVersion;
    readonly versionState?: 'current' | 'candidate' | 'stale' | 'revoked' | 'out-of-scope';
    readonly authorityClass?: 'native' | 'fixture-confirmed' | 'candidate' | 'external' | string;
    readonly authority?: number;
    readonly required?: boolean;
    readonly goalRefs?: readonly string[];
    readonly dependencyRole?: 'direct' | 'same-goal' | 'background' | string;
    readonly observationSequence?: number;
    readonly sequence?: number;
    readonly relevance?: number;
    readonly title?: string;
    readonly missingFields?: readonly string[];
    readonly cursor?: string;
}
export interface EvidenceProjectionOptions {
    readonly workspaceId?: string;
    readonly canonicalOuterId?: string;
    readonly childChain?: readonly string[];
    readonly domain?: string;
    readonly namespace?: string;
    readonly language?: string;
    readonly formatProfileId?: string;
    readonly authorityClass?: EvidenceClaim['authorityClass'];
    readonly authority?: number;
    readonly versionState?: EvidenceClaim['versionState'];
    readonly observationSequence?: number;
}
export declare function assertEvidenceText(value: unknown, field?: string): string;
export declare function normalizeEvidenceIdentity(input: EvidenceIdentityInput): EvidenceIdentity;
/** Stable, case-preserving claim key. JSON structure avoids delimiter collisions. */
export declare function evidenceKey(input: EvidenceIdentityInput | EvidenceIdentity): string;
/** Compatibility name used by the SF-19 smoke/legacy adapter call sites. */
export declare const makeEvidenceIdentityKey: typeof evidenceKey;
/** Alias used by callers that name the final key explicitly as a claim key. */
export declare const claimIdentityKey: typeof evidenceKey;
export declare function evidenceResourceKey(input: EvidenceIdentityInput | EvidenceIdentity): string;
export declare const resourceIdentityKey: typeof evidenceResourceKey;
export declare function normalizeEvidenceVersion(version: EvidenceVersion | EvidenceRevision | undefined): EvidenceVersion;
export declare function evidenceVersionKey(version: EvidenceVersion | EvidenceRevision | undefined): string;
/**
 * Exact version matching. No dictionary ordering is used for revisions: a
 * revision is an opaque host token, and a reader/schema change invalidates the
 * old derived claim even when the bytes/hash are unchanged.
 */
export declare function evidenceVersionsEqual(left: EvidenceVersion | EvidenceRevision | undefined, right: EvidenceVersion | EvidenceRevision | undefined): boolean;
export declare function evidenceVersionMatchesCurrent(candidate: EvidenceVersion | EvidenceRevision | undefined, current: EvidenceVersion | EvidenceRevision | undefined): boolean;
/**
 * Project a checked native/tool payload into independent typed claims. This is
 * intentionally conservative: if the payload does not expose an explicit
 * workspace, outer resource and object handle, no claim is fabricated.
 */
export declare function projectEvidenceClaims(payload: unknown, options?: EvidenceProjectionOptions): EvidenceClaim[];
