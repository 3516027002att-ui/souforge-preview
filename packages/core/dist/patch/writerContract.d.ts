import type { ConfirmationReceipt, Diagnostic, EditRiskAssessment, EditRiskLevel, IndexedFile, ResourceKind, WriterContract } from '@soulforge/shared';
import { type ResourceCapabilityMatrix } from '../capabilities/resourceCapabilities.js';
/**
 * Resolve the primary (legacy) writer contract for text gate compatibility.
 * Semantic/native packed still has capability none for *text* path.
 * Raw path uses evaluateRawWriterGate / resolveWriterCapabilities instead.
 */
export declare function resolveWriterContract(file: IndexedFile): WriterContract;
export interface ResolvedWriterCapabilities {
    text: WriterContract;
    raw: WriterContract;
    semantic: WriterContract;
    matrix: ResourceCapabilityMatrix;
}
/** Split text / raw / semantic contracts — raw is never claimed as semantic/native. */
export declare function resolveWriterCapabilities(file: IndexedFile): ResolvedWriterCapabilities;
/**
 * Gate raw writes (replace / byte range). Requires confirmation for caution/high.
 */
export declare function evaluateRawWriterGate(input: {
    file: IndexedFile;
    capabilities?: ResourceCapabilityMatrix;
    confirmation?: ConfirmationReceipt;
    operation: 'replace' | 'byte_range';
}): WriterGateResult;
export interface AssessEditRiskOptions {
    /** Preview was truncated (partial read). */
    truncated?: boolean;
    /** Structured preview reported editable=false or unsupported. */
    structuredEditable?: boolean;
    parseStatus?: string;
}
/**
 * Files-mode risk assessment. Drives UI warnings and confirmation receipts.
 * Does not grant write permission by itself — Patch Engine + contract still apply.
 */
export declare function assessEditRisk(file: IndexedFile, options?: AssessEditRiskOptions): EditRiskAssessment;
export interface WriterGateInput {
    file: IndexedFile;
    changeKind: 'text' | 'structured' | 'binary';
    confirmation?: ConfirmationReceipt;
    riskOptions?: AssessEditRiskOptions;
}
export interface WriterGateResult {
    ok: boolean;
    risk: EditRiskAssessment;
    diagnostics: Diagnostic[];
}
/**
 * Gate a proposed write against the writer contract and optional confirmation receipt.
 * Structured / binary always fail until a real resource writer is registered.
 */
export declare function evaluateWriterGate(input: WriterGateInput): WriterGateResult;
export declare function createConfirmationReceipt(input: {
    subjects: string[];
    riskLevel: EditRiskLevel;
    sourceUri?: string;
    note?: string;
    policyTags?: string[];
}): ConfirmationReceipt;
export declare function isDirectTextEditable(file: IndexedFile): boolean;
/** Placeholder structured writer registry — empty until real implementations land. */
export declare function listStructuredWriterKinds(): ResourceKind[];
export declare function hasStructuredWriter(_kind: ResourceKind): boolean;
