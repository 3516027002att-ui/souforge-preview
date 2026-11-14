import type { PatchIR, PatchIrOperation, ValidatorContract, ValidatorResult } from '@soulforge/shared';
export declare class TextFileValidator implements ValidatorContract {
    readonly validatorId = "text_file";
    readonly targetResourceKinds: readonly ["*"];
    readonly validationScope: readonly ["before_staging", "staged_output", "after_commit"];
    validateBeforeStaging(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
    }): Promise<ValidatorResult>;
    validateStagedOutput(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
        stagingRoot: string;
        stagedPaths: string[];
    }): Promise<ValidatorResult>;
    validateAfterCommit(input: {
        patch: PatchIR;
        operations: PatchIrOperation[];
        committedPaths: string[];
    }): Promise<ValidatorResult>;
}
