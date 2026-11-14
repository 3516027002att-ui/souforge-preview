import type { Diagnostic, EventExport } from '@soulforge/shared';
export interface ParseEventTextInput {
    sourceUri: string;
    sourcePath: string;
    text: string;
    mapId?: string;
}
export interface ParseEventTextResult {
    export: EventExport;
    diagnostics: Diagnostic[];
}
/**
 * Parses decompiled or hand-written event text into SoulForge's event symbol model.
 *
 * This parser is intentionally heuristic. It is not a binary EMEVD parser and must
 * not be treated as authoritative. Its job is to make text-based event projects,
 * mock fixtures, and DarkScript/EVS-like sources useful before SoulsFormats is wired.
 */
export declare function parseEventText(input: ParseEventTextInput): ParseEventTextResult;
