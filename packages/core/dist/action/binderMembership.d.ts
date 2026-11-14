/**
 * Platform-independent Binder membership resolution.
 *
 * This module deliberately knows nothing about BND4/DCX parsing or the
 * filesystem.  Callers provide already-read entry identities together with
 * their source provenance, and this module only performs the identity match.
 * Therefore a UNIQUE result is a deterministic projection, not native
 * verification of the container or its semantics.
 */
export type BinderSourceRevision = string | number | null;
export interface BinderSourceIdentity {
    /** Stable source identity supplied by the caller; never reconstructed here. */
    sourceUri: string;
    /** Optional physical/source path retained for later diagnostics and IPC. */
    sourcePath?: string;
    /** Optional content identity retained without interpretation. */
    sourceHash?: string;
    /** Caller-owned revision token; may be a scan revision or a content revision. */
    sourceRevision?: BinderSourceRevision;
    /** Optional layer metadata, for example an overlay/base source. */
    sourceLayer?: 'overlay' | 'base';
}
export interface BinderEntryIdentity {
    /** Exact native Binder entry id. It is never matched by name or array order. */
    entryId: number;
    /** Optional native entry index, retained as metadata only. */
    entryIndex?: number;
    /** Optional entry name, retained as metadata only. */
    entryName?: string;
}
export interface BinderMembershipCandidate {
    /** Canonical character-family key supplied by the caller. Comparison is exact. */
    characterFamily: string;
    source: BinderSourceIdentity;
    entries: readonly BinderEntryIdentity[];
}
export interface BinderMembershipQuery {
    /** Canonical character-family key; candidates from other families are ignored. */
    characterFamily: string;
    /** Exact Binder entry id to resolve. */
    binderEntryId: number;
}
export interface BinderMembershipMatch extends BinderSourceIdentity {
    characterFamily: string;
    binderEntryId: number;
    entryIndex?: number;
    entryName?: string;
}
export interface BinderMembershipSource {
    characterFamily: string;
    source: BinderSourceIdentity;
}
export interface BinderMembershipDiagnostic {
    code: 'BINDER_QUERY_INVALID' | 'BINDER_CANDIDATE_INVALID' | 'BINDER_ENTRY_INVALID';
    message: string;
    sourceUri?: string;
}
interface BinderMembershipResultBase {
    query: BinderMembershipQuery;
    /** Only same-family candidates are reported; cross-family sources do not leak. */
    consideredSources: readonly BinderMembershipSource[];
    diagnostics: readonly BinderMembershipDiagnostic[];
}
export type BinderMembershipResult = (BinderMembershipResultBase & {
    status: 'UNIQUE';
    match: BinderMembershipMatch;
}) | (BinderMembershipResultBase & {
    status: 'NOT_FOUND';
    match: undefined;
}) | (BinderMembershipResultBase & {
    status: 'AMBIGUOUS';
    match: undefined;
    matches: readonly BinderMembershipMatch[];
});
/**
 * Resolve one exact Binder entry id within one character family.
 *
 * A result is UNIQUE only when exactly one valid entry match exists across all
 * same-family candidates. Zero matches is NOT_FOUND. Every other cardinality
 * is AMBIGUOUS. Input order is never used to choose a winner.
 */
export declare function resolveBinderMembership(input: {
    query: BinderMembershipQuery;
    candidates: readonly BinderMembershipCandidate[];
}): BinderMembershipResult;
export {};
