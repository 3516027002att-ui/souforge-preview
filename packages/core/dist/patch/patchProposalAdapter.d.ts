/**
 * Compile legacy PatchProposal / PatchChange inputs into PatchIR.
 * Pure conversion — no filesystem I/O.
 *
 * text -> text_edit / file_replace
 * binary / structured -> blocked with NATIVE_WRITER_REQUIRED (or explicit block)
 */
import type { Diagnostic, PatchChange, PatchIR, PatchIrOperation, PatchProposal, StructuredDiagnostic } from '@soulforge/shared';
export interface CompilePatchProposalResult {
    ok: boolean;
    patch?: PatchIR;
    operations: PatchIrOperation[];
    diagnostics: StructuredDiagnostic[];
    /** Legacy Diagnostic[] for callers still on the old shape. */
    legacyDiagnostics: Diagnostic[];
}
/**
 * Convert a full legacy proposal into PatchIR.
 */
export declare function compilePatchProposalToPatchIr(proposal: PatchProposal): CompilePatchProposalResult;
/**
 * Convert a single legacy PatchChange into a PatchIrOperation when supported.
 */
export declare function compilePatchChangeToOperation(change: PatchChange): {
    operation?: PatchIrOperation;
    diagnostics: StructuredDiagnostic[];
};
