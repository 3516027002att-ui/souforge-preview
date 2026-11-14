/**
 * SoulForge synthetic BND3/BND4 (SFBN marker) — full list/read/replace/repack.
 *
 * Layout (documented in docs/V0_3_SYNTHETIC_BND_FIXTURE.md):
 *   0x00 magic BND3|BND4
 *   0x04 marker SFBN
 *   0x08 version=1
 *   0x0C child count
 *   0x10 child table start
 *   0x14 string pool start
 *   rows: id, nameRel, dataOffset, packedSize, unpackedSize (32 bytes)
 *
 * This is NOT native FromSoftware BND authority. It is fixture-confirmed
 * authoritative for SoulForge-owned synthetic binders only.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import type { ContainerChild, ContainerFormat, ContainerRoundTripReport } from './containerIr.js';
export interface SyntheticBndChild {
    id: number;
    name: string;
    offset: number;
    packedSize: number;
    unpackedSize: number;
    bytes: Buffer;
    hash: string;
}
export interface SyntheticBndReadResult {
    ok: boolean;
    format: ContainerFormat;
    version: number;
    children: SyntheticBndChild[];
    childTableStart: number;
    stringPoolStart: number;
    authority: 'fixture-confirmed' | 'none';
    diagnostics: StructuredDiagnostic[];
}
export declare function isSyntheticBnd(bytes: Buffer): boolean;
/**
 * Parse synthetic SFBN binder. Returns ok=false for non-synthetic or corrupt.
 */
export declare function readSyntheticBnd(bytes: Buffer): SyntheticBndReadResult;
export interface BuildSyntheticBndInput {
    format?: 'bnd3' | 'bnd4';
    children: Array<{
        id: number;
        name: string;
        bytes: Buffer;
    }>;
}
/**
 * Build a synthetic SFBN binder. Unmodified child bytes are byte-preserving.
 */
export declare function buildSyntheticBnd(input: BuildSyntheticBndInput): {
    ok: boolean;
    bytes?: Buffer;
    hash?: string;
    children: SyntheticBndChild[];
    diagnostics: StructuredDiagnostic[];
};
export declare function replaceSyntheticBndChild(original: Buffer, childSelector: string | number, newBytes: Buffer): {
    ok: boolean;
    bytes?: Buffer;
    hash?: string;
    previousChildHash?: string;
    newChildHash?: string;
    diagnostics: StructuredDiagnostic[];
};
export declare function roundTripSyntheticBnd(original: Buffer): ContainerRoundTripReport;
export declare function toContainerChildren(sourceContainerUri: string, read: SyntheticBndReadResult, pathPrefix: string): ContainerChild[];
