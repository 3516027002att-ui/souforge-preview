import { createHash } from 'node:crypto';
/**
 * 24.4 G-1 types — single source of truth for fingerprint schema.
 * Do not duplicate or diverge this schema elsewhere (5.6 §2).
 */
export interface FileFingerprintV1 {
    relativePath: string;
    size: number;
    mtimeNs: string;
    ctimeNs: string;
    fileIdentity: string | null;
    pathSourceGeneration: number;
}
export interface PersistedHashV1 extends FileFingerprintV1 {
    sha256: string;
    lastVerifiedAtUtc: string;
    fingerprintStoreGeneration: number;
}
export interface WorkspaceScanGeneration {
    workspaceId: string;
    workspaceSessionGeneration: number;
    fingerprintStoreGeneration: number;
    abort: AbortController;
}
export interface FingerprintContinuityV1 {
    workspacePersistentIdentityHash: string;
    volumeIdentity: string;
    usnJournalId: string | null;
    lastConsumedUsn: string | null;
    watcherEpoch: string;
    cleanShutdown: boolean;
    continuity: 'PROVEN' | 'UNKNOWN';
    unknownReason: 'FIRST_OPEN' | 'JOURNAL_UNAVAILABLE' | 'JOURNAL_ID_CHANGED' | 'JOURNAL_GAP' | 'WATCHER_OVERFLOW' | 'UNCLEAN_SHUTDOWN' | null;
}
export interface HashContinuationV1 {
    workspaceId: string;
    workspaceSessionGeneration: number;
    fingerprint: FileFingerprintV1;
    offset: number;
    openHandle: import('node:fs/promises').FileHandle | null;
    incrementalHasher: ReturnType<typeof createHash> | null;
    queuedSequence: number;
}
export declare function makeWorkspacePersistentIdentityHash(args: {
    workspaceId: string;
    game: string;
    physicalOverlayRootHash: string;
    physicalBaseRootHash?: string;
}): string;
export declare function fingerprintEquals(a: FileFingerprintV1, b: FileFingerprintV1): boolean;
export declare function makeFileFingerprint(args: {
    relativePath: string;
    size: number;
    mtimeNs: string;
    ctimeNs: string;
    fileIdentity: string | null;
    pathSourceGeneration: number;
}): FileFingerprintV1;
export declare function canReusePersistedHash(args: {
    fingerprint: FileFingerprintV1;
    persisted: PersistedHashV1 | undefined;
    currentStoreGeneration: number;
    continuity: FingerprintContinuityV1;
    workspaceIdentityMatches: boolean;
}): {
    reuse: boolean;
    reason: string;
};
export declare function normalizeMtimeNs(stat: {
    mtimeNs?: bigint;
    mtimeMs: number;
}): string;
export declare function normalizeCtimeNs(stat: {
    ctimeNs?: bigint;
    ctimeMs: number;
    birthtimeMs?: number;
}): string;
export declare function fileIdentityFromStat(stat: {
    dev?: number | bigint;
    ino?: number | bigint;
}): string | null;
/** For tests: build a persisted entry quickly */
export declare function toPersistedHash(fp: FileFingerprintV1, sha256: string, storeGen: number): PersistedHashV1;
