/**
 * Raw-level full/range read for any indexed file.
 * Preview prefixes remain separate; this API is honest about full vs range.
 */
import type { Diagnostic, IndexedFile } from '@soulforge/shared';
import { type ResourceCapabilityMatrix } from '../capabilities/resourceCapabilities.js';
export interface RawResourceMetadata {
    sourceUri: string;
    absolutePath: string;
    relativePath: string;
    size: number;
    mtimeMs: number;
    contentHash?: string;
    hashStatus: 'full' | 'deferred' | 'unavailable';
    formatKind: IndexedFile['formatKind'];
    compoundExtension: string;
    looksBinary: boolean;
    capabilities: ResourceCapabilityMatrix;
    diagnostics: Diagnostic[];
}
export interface RawResourceRangeResult {
    ok: boolean;
    sourceUri: string;
    offset: number;
    length: number;
    fileSize: number;
    base64?: string;
    sha256OfRange?: string;
    diagnostics: Diagnostic[];
}
export interface TextResourceFullResult {
    ok: boolean;
    sourceUri: string;
    text?: string;
    byteLength: number;
    contentHash?: string;
    encoding: 'utf-8' | 'invalid';
    diagnostics: Diagnostic[];
}
export declare function readRawResourceMetadata(file: IndexedFile, options?: {
    computeHash?: boolean;
    hashCapBytes?: number;
}): Promise<RawResourceMetadata>;
export declare function readRawResourceRange(file: IndexedFile, offset: number, length: number): Promise<RawResourceRangeResult>;
export declare function readTextResourceFull(file: IndexedFile): Promise<TextResourceFullResult>;
