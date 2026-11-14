/**
 * Lightweight file probe for VFS open-time scans.
 * Never full-reads large / packed payloads just to build the tree.
 */
import type { VfsHashStatus } from '@soulforge/shared';
/** Default prefix used for binary sniff + optional partial hash. */
export declare const DEFAULT_PROBE_PREFIX_BYTES: number;
/** Files at or below this size may receive immediate full sha256. */
export declare const DEFAULT_SMALL_FILE_HASH_BYTES: number;
export interface ProbeFileOptions {
    maxPrefixBytes?: number;
    smallFileHashBytes?: number;
    /** Force skip full hash even for small files. */
    deferHash?: boolean;
}
export interface FileProbeResult {
    size: number;
    prefix: Buffer;
    bytesRead: number;
    looksBinary: boolean;
    contentHash?: string;
    hashStatus: VfsHashStatus;
}
export declare function readPrefix(path: string, maxBytes: number): Promise<{
    size: number;
    prefix: Buffer;
    bytesRead: number;
}>;
export declare function detectBinaryFromPrefix(prefix: Buffer): boolean;
export declare function maybeHashSmallFile(input: {
    size: number;
    prefix: Buffer;
    bytesRead: number;
    smallFileHashBytes: number;
    deferHash?: boolean;
}): {
    contentHash?: string;
    hashStatus: VfsHashStatus;
};
export declare function probeFile(path: string, options?: ProbeFileOptions): Promise<FileProbeResult>;
