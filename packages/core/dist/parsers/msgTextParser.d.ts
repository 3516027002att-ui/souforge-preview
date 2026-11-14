import type { Diagnostic, MsgExport } from '@soulforge/shared';
export interface ParseMsgTextInput {
    sourceUri: string;
    sourcePath: string;
    text: string;
    category?: string;
}
export interface ParseMsgTextResult {
    export: MsgExport;
    diagnostics: Diagnostic[];
}
/**
 * Parses lightweight text fixtures and exported FMG-like text into MsgExport.
 *
 * Supported inputs:
 * - JSON array of { textId, text, category? }
 * - JSON object with { category?, entries: [...] }
 * - TSV/CSV-ish lines: 1000<TAB>Hello or 1000,Hello
 * - XML-ish FMG entries: <text id="1000">Hello</text>
 */
export declare function parseMsgText(input: ParseMsgTextInput): ParseMsgTextResult;
