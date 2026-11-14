import type { PatchIR, PatchIrOperation, WriterAdapterContract, WriterApplyResult, WriterRollbackMetadata, WriterWritePlan } from '@soulforge/shared';
/**
 * Synthetic resource writer for event/param/map/msg-like test resources.
 * Does NOT represent a native FromSoftware writer.
 */
export declare class SyntheticResourceWriter implements WriterAdapterContract {
    readonly writerId = "writer:synthetic-resource";
    readonly supportedResourceKinds: readonly ["event", "param", "map", "msg", "other"];
    readonly supportedOperations: readonly ["synthetic_resource_edit"];
    readonly inputSchemaVersion = "soulforge.syntheticResourceEdit.v1";
    readonly preconditions: readonly ["synthetic fixture only", "nativeFormatAuthority must remain false", "staging only"];
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
