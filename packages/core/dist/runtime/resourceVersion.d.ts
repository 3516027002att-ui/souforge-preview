/**
 * Canonical resource identity, version comparison and dependency summaries
 * (执行指令 §4.1/§4.2, T02).
 *
 * This module never parses game binaries. It stores what a reader observed:
 * outer container hash, child payload hash, reader/metadata schema versions
 * and a host-maintained generation. mtime/size are cheap pre-filters only and
 * never prove content immutability.
 */
export interface ResourceVersion {
    /** SHA-256 of the outer container file on disk (CAS + shared-container invalidation). */
    outerFileHash: string;
    /** SHA-256 of the unpacked child payload / inner document (per-document write precondition). */
    payloadHash?: string;
    /** SHA-256 of one physical row's bytes (physical row precondition; never replaces outer version). */
    rowHash?: string;
    /** Monotonic revision supplied by the repository/workspace index. */
    sourceRevision?: number;
    /** Schema version of the parser/reader (EMEDF fingerprint, paramdef version, …). */
    readerSchemaVersion?: string | number;
    /** Schema / fingerprint of the external metadata package. */
    metadataSchemaVersion?: string | number;
    /** Host-maintained counter identifying this session's observation of the source. */
    generation: number;
    /** Stat mtime in milliseconds (cheap pre-filter only). */
    mtimeMs?: number;
    /** Stat size in bytes (cheap pre-filter only). */
    sizeBytes?: number;
}
/**
 * Physical identity that never loses child addressing. Display labels, query
 * terms and filename tails must never enter these keys.
 */
export interface ResourceIdentity {
    workspaceId: string;
    sourceUri: string;
    domain: string;
    childChain?: readonly string[];
    entryIndex?: number;
    entryName?: string;
    rowId?: number;
    rowIndex?: number;
    eventId?: number;
    textId?: number;
    animId?: number;
    eventIndex?: number;
    taeEntryIndex?: number;
    nativeObjectKey?: string;
}
export type VersionComparisonResult = 'equal' | 'stale' | 'newer' | 'unknown';
/**
 * Stable key for one object that preserves child identity.
 * Two rows with the same logical rowId but different physical rowIndex, two
 * entries with the same name but different entryIndex, the same eventId in
 * different files, and the same relative path in different workspaces all get
 * different keys.
 */
export declare function computeResourceKey(identity: ResourceIdentity): string;
/**
 * Compare a reference version against the current observed version.
 *
 * - Missing either side, or a missing outerFileHash on either side, returns
 *   `unknown` — absent information never means `equal`.
 * - Different outer hash, payload hash, row hash, reader schema or metadata
 *   schema means the reference no longer describes what is live: `stale`.
 * - Same bytes but a host generation change (H0→H1→H0) is still `stale`:
 *   accidental byte equality must not resurrect old proofs.
 * - A reference observed with a strictly higher generation than the current
 *   record returns `newer` (a late async result must not overwrite the live
 *   projection).
 */
export declare function compareResourceVersion(current?: ResourceVersion | null, reference?: ResourceVersion | null): VersionComparisonResult;
export interface DependencySummaryEntry {
    /** computeResourceKey() of the depended-on object. */
    sourceKey: string;
    outerFileHash?: string;
    payloadHash?: string;
    sourceRevision?: number;
    readerSchemaVersion?: string | number;
    metadataSchemaVersion?: string | number;
    generation?: number;
}
export interface DependencySummary {
    catalogGeneration: number;
    readerSchemaVersion?: string | number;
    metadataSchemaVersion?: string | number;
    entries: DependencySummaryEntry[];
}
/**
 * Deterministic dependency summary for snapshot identity.
 * Entries are sorted by source key; the summary identifies a snapshot but
 * never replaces per-source evidence.
 */
export declare function computeDependencySummary(entries: readonly DependencySummaryEntry[], options: {
    catalogGeneration: number;
    readerSchemaVersion?: string | number;
    metadataSchemaVersion?: string | number;
}): DependencySummary;
/**
 * True when two summaries describe the same snapshot. Used to reject page
 * cursors whose underlying sources drifted.
 */
export declare function dependencySummariesMatch(a: DependencySummary | undefined, b: DependencySummary | undefined): boolean;
