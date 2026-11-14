/**
 * Capture precise resource-entry inverse PatchIR for native BND4 mutations.
 * Inverse ops are persisted with the original operation and used by
 * rollbackResourceEntry; writers never self-commit.
 */
import type { Diagnostic, PatchIrOperation } from '@soulforge/shared';
export interface ResourceEntryChangeInput {
    id: string;
    resourceUri: string;
    entryUri: string;
    changeKind: string;
    beforeHash?: string;
    afterHash?: string;
    inverse: PatchIrOperation;
}
export interface NativeBnd4ChildSnapshot {
    sourceHash: string;
    index: number;
    flags: number;
    unknown: number;
    id: number;
    name: string;
    contentHash: string;
    contentBase64: string;
}
/**
 * Capture resource-entry inverse records for native BND4 ops in a patch.
 * Returns diagnostics when capture fails; callers must refuse the write.
 */
export declare function captureNativeBnd4ResourceEntryChanges(operations: PatchIrOperation[], workspaceRoot: string): Promise<{
    changes: ResourceEntryChangeInput[];
    diagnostics: Diagnostic[];
}>;
export declare function isValidResourceEntryInverse(change: {
    changeKind: string;
    beforeHash?: string;
    afterHash?: string;
    inverse: PatchIrOperation;
}, containerAfterHash: string | undefined): {
    ok: true;
} | {
    ok: false;
    code: string;
    message: string;
};
