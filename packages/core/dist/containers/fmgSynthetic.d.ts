/**
 * SoulForge synthetic FMG (SFFX marker) — parse / update entry / rebuild.
 * Fixture-confirmed authoritative for owned fixtures only; not native FMG authority.
 *
 * Layout: docs/V0_3_FMG_SYNTHETIC_FIXTURE.md
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
export interface FmgEntry {
    textId: number;
    text: string;
    tableOffset: number;
    textOffset: number;
}
export interface FmgParseResult {
    ok: boolean;
    authority: 'fixture-confirmed' | 'none' | 'candidate';
    version: number;
    entries: FmgEntry[];
    tableStart: number;
    stringPoolStart: number;
    diagnostics: StructuredDiagnostic[];
    nativeFormatAuthority: false;
}
export declare function isSyntheticFmg(bytes: Buffer): boolean;
export declare function parseSyntheticFmg(bytes: Buffer): FmgParseResult;
export declare function buildSyntheticFmg(entries: Array<{
    textId: number;
    text: string;
}>): {
    ok: boolean;
    bytes?: Buffer;
    hash?: string;
    diagnostics: StructuredDiagnostic[];
};
export declare function updateSyntheticFmgEntry(original: Buffer, textId: number, newText: string): {
    ok: boolean;
    bytes?: Buffer;
    hash?: string;
    diagnostics: StructuredDiagnostic[];
};
export declare function roundTripSyntheticFmg(original: Buffer): {
    ok: boolean;
    entriesMatch: boolean;
    originalHash: string;
    rebuiltHash: string;
    diagnostics: StructuredDiagnostic[];
};
