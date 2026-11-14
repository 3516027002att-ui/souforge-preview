/**
 * Deterministic Live Diagnostics Engine for EMEVD DarkScript3.
 *
 * Emits structured diagnostics for:
 * - Unknown instruction & typos
 * - Argument count mismatch
 * - Argument integer overflow / type mismatch
 * - Invalid enum members
 * - Malformed / undeclared event parameter slots (Xn_size)
 * - Duplicate event IDs
 * - Unclosed brackets
 */
import type { EmedfCompletionItem } from '../emedfCompletionCatalog.js';
import type { EmedfEnumDef } from '../emedfSchema.js';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';
export interface EventDiagnostic {
    from: number;
    to: number;
    line: number;
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    suggestedFixes?: Array<{
        title: string;
        replacement: string;
        from: number;
        to: number;
    }>;
}
/**
 * Levenshtein distance for typo suggestions.
 */
export declare function levenshtein(a: string, b: string): number;
/**
 * Find closest instruction names in catalog.
 */
export declare function findClosestInstruction(name: string, catalog: readonly EmedfCompletionItem[], maxDistance?: number): string[];
/**
 * Compute all diagnostics for a DarkScript3 document.
 */
export declare function computeDocumentDiagnostics(text: string, catalog: readonly EmedfCompletionItem[], enums?: Record<string, EmedfEnumDef>): EventDiagnostic[];
