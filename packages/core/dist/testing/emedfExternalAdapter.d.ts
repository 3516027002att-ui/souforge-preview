/**
 * External-only adapter for DarkScript3-format EMEDF JSON files.
 *
 * This module is an external-only development/validation adapter. Production
 * never reads a user-provided EMEDF file and never uses this adapter at
 * runtime. The checked-in production registry is maintained separately as
 * SoulForge first-party semantic data; this adapter remains local-only for
 * cross-validation.
 *
 * DarkScript3 is "All Rights Reserved" by its copyright owners. This adapter
 * reads from a user-provided local file path (e.g. from the user's own
 * DarkScript3 installation) and converts it to SoulForge's internal registry
 * format for validation only.
 *
 * Type code mapping (DarkScript3 → SoulForge):
 *   0 → u8, 1 → u16, 2 → u32, 3 → s8, 4 → s16, 5 → s32, 6 → f32, 8 → u32
 */
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
export type EmedfImportResult = {
    ok: true;
    registry: EmedfRegistry;
    instructionCount: number;
    bankCount: number;
} | {
    ok: false;
    code: string;
    message: string;
};
/**
 * Parse a DarkScript3 EMEDF JSON string into a SoulForge EmedfRegistry.
 * Does NOT touch the filesystem — callers provide the raw text.
 * Handles JSON with // and /* *​/ comments (Newtonsoft.Json compat).
 */
export declare function parseDs3EmedfJson(jsonText: string): EmedfImportResult;
/**
 * Read and parse a DarkScript3 EMEDF JSON file from a local path.
 * The caller is responsible for ensuring the path is safe and user-provided.
 */
export declare function importDs3EmedfFile(filePath: string): EmedfImportResult;
export declare function sanitizeEnumName(raw: string): string;
export declare function sanitizeEnumMemberName(raw: string): string;
