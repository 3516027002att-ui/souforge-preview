export interface TextEdit {
    startLine: number;
    endLine: number;
    replacement: string[];
}
export interface UnifiedDiffOptions {
    fromFile?: string;
    toFile?: string;
    contextLines?: number;
}
/**
 * Applies 1-based inclusive line edits to a text document.
 * Edits must not overlap. This is useful for AI patch proposals because it can
 * validate exact line ranges before touching staging files.
 */
export declare function applyLineEdits(original: string, edits: readonly TextEdit[]): string;
export declare function createUnifiedDiff(before: string, after: string, options?: UnifiedDiffOptions): string;
