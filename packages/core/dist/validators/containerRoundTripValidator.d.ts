/**
 * Validator for container_child_replace operations.
 */
import type { PatchIR, PatchIrOperation, ValidatorContract, ValidatorResult } from '@soulforge/shared';
export declare class ContainerRoundTripValidator implements ValidatorContract {
    readonly validatorId = "container_roundtrip";
    readonly targetResourceKinds: readonly ["*"];
    readonly validationScope: readonly ["before_staging", "staged_output", "after_commit"];
    validateBeforeStaging(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
    }): Promise<ValidatorResult>;
    validateStagedOutput(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
        stagedPaths: string[];
        stagingRoot: string;
    }): Promise<ValidatorResult>;
    validateAfterCommit(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
        committedPaths: string[];
    }): Promise<ValidatorResult>;
}
