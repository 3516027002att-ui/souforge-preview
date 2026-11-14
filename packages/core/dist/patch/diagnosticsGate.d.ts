import type { Diagnostic, ValidationResult } from '@soulforge/shared';
export interface DiagnosticsGateOptions {
    /**
     * When true, warning-level diagnostics also fail the gate.
     * Default false: only error severity blocks commit.
     */
    failOnWarning?: boolean;
    /**
     * Codes that always block regardless of severity (e.g. policy tags).
     */
    hardBlockCodes?: readonly string[];
}
/**
 * Patch Engine diagnostics gate.
 * Diagnostics are not logs — they drive UI, AI prompts, and commit policy.
 */
export declare function evaluateDiagnosticsGate(diagnostics: readonly Diagnostic[], options?: DiagnosticsGateOptions): ValidationResult;
export declare function mergeValidationResults(...results: ValidationResult[]): ValidationResult;
