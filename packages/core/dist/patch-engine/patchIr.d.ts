/**
 * PatchIR validation and helpers for the architecture scaffold.
 */
import type { PatchIR, PatchIrOperation, PatchIrValidationResult, PatchRiskLevel, StructuredDiagnostic } from '@soulforge/shared';
export declare function createPatchIr(input: {
    workspaceId: string;
    title: string;
    author: PatchIR['author'];
    operations: PatchIrOperation[];
    notes?: string;
}): PatchIR;
/**
 * Create a text_edit operation.
 * Production paths (saveTextResource) MUST pass expectedHash.
 * Low-level tests may omit expectedHash.
 */
export declare function createTextEditOperation(input: {
    targetUri: string;
    targetPath: string;
    newText: string;
    /** sha256 of original file; required for production saves. */
    expectedHash?: string;
    resourceKind?: PatchIrOperation['resourceKind'];
    allowEmpty?: boolean;
}): PatchIrOperation;
export declare function createRawByteRangeOperation(input: {
    targetUri: string;
    targetPath: string;
    offset: number;
    length: number;
    replacement: Buffer | Uint8Array;
    expectedHash: string;
    resourceKind?: PatchIrOperation['resourceKind'];
}): PatchIrOperation;
export declare function validatePatchIr(patch: PatchIR): PatchIrValidationResult;
export declare function collectAffectedResources(operations: readonly PatchIrOperation[]): string[];
export declare function collectPatchDiagnostics(patch: PatchIR): StructuredDiagnostic[];
export declare function estimatePatchRisk(operations: readonly PatchIrOperation[]): PatchRiskLevel;
