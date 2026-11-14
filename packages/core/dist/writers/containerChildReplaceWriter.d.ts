/**
 * Writer for container_child_replace — synthetic SFBN BND and DCX(DFLT)+BND only.
 * Explicit writtenTargets; never claims native game BND/DCX authority beyond fixture path.
 */
import type { PatchIR, PatchIrOperation, WriterAdapterContract, WriterApplyResult, WriterRollbackMetadata, WriterWritePlan } from '@soulforge/shared';
export declare class ContainerChildReplaceWriter implements WriterAdapterContract {
    readonly writerId = "writer:container-child-replace";
    readonly supportedResourceKinds: readonly ["msg", "param", "event", "map", "other", "unknown"];
    readonly supportedOperations: readonly ["container_child_replace", "container_child_add", "container_child_delete", "container_child_rename", "container_child_move"];
    readonly inputSchemaVersion = "soulforge.containerChildReplace.v1";
    readonly preconditions: readonly ["expectedContainerHash", "expectedChildHash", "confirmation required", "authoritative-repack containers only", "staging only"];
    canHandle(operation: PatchIrOperation): boolean;
    writePlan(patch: PatchIR, operations: PatchIrOperation[]): WriterWritePlan;
    applyToStaging(input: {
        stagingRoot: string;
        operations: PatchIrOperation[];
        workspaceRoot?: string;
        oodleRuntimeRoot?: string;
    }): Promise<WriterApplyResult>;
    produceRollbackMetadata(input: {
        operations: PatchIrOperation[];
        backupPaths: string[];
    }): WriterRollbackMetadata;
}
