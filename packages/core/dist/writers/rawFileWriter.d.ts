import type { PatchIR, PatchIrOperation, WriterAdapterContract, WriterApplyResult, WriterRollbackMetadata, WriterWritePlan } from '@soulforge/shared';
export declare class RawFileWriter implements WriterAdapterContract {
    readonly writerId = "writer:raw-file";
    readonly supportedResourceKinds: readonly ["other", "unknown", "obj", "chr", "sfx"];
    readonly supportedOperations: readonly ["raw_byte_range_edit", "file_replace"];
    readonly inputSchemaVersion = "soulforge.rawByteRangeEdit.v1";
    readonly preconditions: readonly ["content hash precondition required", "staging only", "commit owned by WorkspaceTransaction"];
    canHandle(operation: PatchIrOperation): boolean;
    writePlan(patch: PatchIR, operations: PatchIrOperation[]): WriterWritePlan;
    applyToStaging(input: {
        stagingRoot: string;
        operations: PatchIrOperation[];
        workspaceRoot?: string;
    }): Promise<WriterApplyResult>;
    produceRollbackMetadata(input: {
        operations: PatchIrOperation[];
        backupPaths: string[];
    }): WriterRollbackMetadata;
}
