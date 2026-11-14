import type { PatchIR, PatchIrOperation, ValidatorContract, ValidatorResult } from '@soulforge/shared';
/**
 * Ensures high-risk packed/native Files Mode writes carry confirmation metadata.
 * Does not implement native writers.
 */
export declare class FileRiskValidator implements ValidatorContract {
    readonly validatorId = "file_risk";
    readonly targetResourceKinds: readonly ["*"];
    readonly validationScope: readonly ["before_staging", "any"];
    validateBeforeStaging(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
    }): ValidatorResult;
}
export declare class WorkspaceBoundaryValidator implements ValidatorContract {
    readonly validatorId = "workspace_boundary";
    readonly targetResourceKinds: readonly ["*"];
    readonly validationScope: readonly ["before_staging"];
    validateBeforeStaging(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
    }): ValidatorResult;
}
export declare class WholeFileReplaceValidator implements ValidatorContract {
    readonly validatorId = "whole_file_replace";
    readonly targetResourceKinds: readonly ["*"];
    readonly validationScope: readonly ["before_staging", "staged_output"];
    validateBeforeStaging(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
    }): ValidatorResult;
}
