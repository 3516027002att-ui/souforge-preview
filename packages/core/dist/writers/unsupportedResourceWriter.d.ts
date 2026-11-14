import type { PatchIR, PatchIrOperation, WriterAdapterContract, WriterApplyResult, WriterRollbackMetadata, WriterWritePlan } from '@soulforge/shared';
/**
 * Always rejects structured/native writes with clear diagnostics.
 */
export declare class UnsupportedResourceWriter implements WriterAdapterContract {
    readonly writerId = "writer:unsupported";
    readonly supportedResourceKinds: readonly ["event", "map", "param", "msg", "menu", "script", "action", "ai", "sfx", "chr", "obj", "other", "unknown"];
    readonly supportedOperations: readonly ["structured_edit", "container_child_edit"];
    readonly inputSchemaVersion = "";
    readonly preconditions: readonly ["native writer not registered", "structured write forbidden without fixture-confirmed implementation"];
    canHandle(_operation: PatchIrOperation): boolean;
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
