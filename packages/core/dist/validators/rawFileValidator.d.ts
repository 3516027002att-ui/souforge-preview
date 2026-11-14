import type { PatchIR, PatchIrOperation, ValidatorContract, ValidatorResult } from '@soulforge/shared';
export declare class RawFileValidator implements ValidatorContract {
    readonly validatorId = "raw_file";
    readonly targetResourceKinds: readonly ["*"];
    readonly validationScope: readonly ["before_staging", "staged_output"];
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
}
