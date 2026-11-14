/**
 * Shared content-hash checks for text/raw scaffold writers and validators.
 */
import type { PatchIrOperation, StructuredDiagnostic } from '@soulforge/shared';
export declare function sha256File(path: string): Promise<string>;
export declare function sha256Buffer(bytes: Buffer | Uint8Array | string): string;
/**
 * Resolve the expected content hash for an operation, if any.
 * Prefer explicit expectedHash; fall back to content_hash preconditions.
 */
export declare function resolveExpectedHash(op: PatchIrOperation): string | undefined;
export type HashCheckPhase = 'before_staging' | 'apply_to_staging' | 'staged_output' | 'before_commit';
/**
 * When expectedHash is set, the on-disk original must match or the write is blocked.
 * Production text path always sets expectedHash; low-level ops may omit it.
 */
export declare function checkOriginalContentHash(op: PatchIrOperation, phase: HashCheckPhase, options?: {
    requireForTextEdit?: boolean;
}): Promise<StructuredDiagnostic[]>;
/** Production text-edit ops should carry expectedHash. */
export declare function requireTextEditHash(op: PatchIrOperation): StructuredDiagnostic[];
