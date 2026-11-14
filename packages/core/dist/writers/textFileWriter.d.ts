import type { PatchIR, PatchIrOperation, WriterAdapterContract, WriterApplyResult, WriterRollbackMetadata, WriterWritePlan } from '@soulforge/shared';
export declare class TextFileWriter implements WriterAdapterContract {
    readonly writerId = "writer:text-file";
    readonly supportedResourceKinds: readonly ["msg", "event", "script", "action", "other", "unknown", "menu", "ai"];
    readonly supportedOperations: readonly ["text_edit", "file_replace"];
    readonly inputSchemaVersion = "soulforge.textContentEdit.v1";
    readonly preconditions: readonly ["target is staging path only", "UTF-8 text content", "commit owned by WorkspaceTransaction"];
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
