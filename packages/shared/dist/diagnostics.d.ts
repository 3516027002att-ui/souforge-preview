/**
 * Structured diagnostics for safety gates (architecture forks #109, #151 area).
 * Extends the lightweight Diagnostic used across the product with URI / provenance hooks.
 */
import type { ConfidenceAssessment } from './confidence.js';
import type { ProvenanceChain } from './provenance.js';
import type { Diagnostic, DiagnosticSeverity } from './types.js';
export type DiagnosticCode = string | 'UNSUPPORTED_FORMAT' | 'PARSE_FAILED' | 'PARSE_PARTIAL' | 'WRITER_CONTRACT_ABSENT' | 'VALIDATOR_FAILED' | 'PRECONDITION_FAILED' | 'HASH_MISMATCH' | 'POLICY_DENIED' | 'TRANSACTION_FAILED' | 'ROLLBACK_FAILED' | 'SCHEMA_MISMATCH' | 'INSUFFICIENT_EVIDENCE' | 'SYNTHETIC_NOT_NATIVE' | 'STAGING_INVALID' | 'COMMIT_BLOCKED';
export interface StructuredDiagnostic {
    severity: DiagnosticSeverity;
    code: DiagnosticCode;
    message: string;
    /** ResourceURI / FieldURI / file URI target when known. */
    targetUri?: string;
    sourceUri?: string;
    provenance?: ProvenanceChain;
    confidence?: ConfidenceAssessment;
    details?: unknown;
    /** ISO-8601 */
    recordedAt?: string;
}
export interface DiagnosticAttachment {
    targetUri: string;
    diagnostics: StructuredDiagnostic[];
}
export declare function toLegacyDiagnostic(item: StructuredDiagnostic): Diagnostic;
export declare function fromLegacyDiagnostic(item: Diagnostic): StructuredDiagnostic;
export declare function createDiagnostic(partial: Omit<StructuredDiagnostic, 'recordedAt'> & {
    recordedAt?: string;
}): StructuredDiagnostic;
export declare function hasErrorDiagnostics(items: readonly StructuredDiagnostic[]): boolean;
export declare function collectDiagnosticCodes(items: readonly StructuredDiagnostic[]): string[];
