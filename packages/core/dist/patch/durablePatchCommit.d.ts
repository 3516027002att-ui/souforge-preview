import type { Diagnostic, GraphPatch, OperationLogRecord, PatchIR, PatchIrOperation, PatchMode, ValidatorContract } from '@soulforge/shared';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import { type OperationLogStore } from './operationLog.js';
export interface ExecutePatchIrOptions {
    workspaceRoot?: string;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    actorId?: string;
    recoveryDir?: string;
    mode?: PatchMode;
    author?: 'user' | 'ai';
    graph?: GraphPatch;
    inverseOfOpId?: string;
    rollbackScope?: OperationLogRecord['rollbackScope'];
    rollbackTargetUri?: string;
    /**
     * Validators appended after the scaffold list. after_commit validators here
     * run inside the transaction's commit boundary: a failure rolls the files
     * back and the operation log records the recovery (e.g. EMEVD Bridge reopen).
     */
    appendValidators?: ValidatorContract[];
    resourceEntryChanges?: Array<{
        id: string;
        resourceUri: string;
        entryUri: string;
        changeKind: string;
        beforeHash?: string;
        afterHash?: string;
        inverse: PatchIrOperation;
    }>;
}
export interface TransactionCommitCompatResult {
    opId: string;
    backupRoot: string;
    changedFiles: string[];
    diagnostics: Diagnostic[];
    operation?: OperationLogRecord;
    recoveryPath?: string;
}
export declare function executePatchIrThroughTransaction(patch: PatchIR, options?: ExecutePatchIrOptions): Promise<TransactionCommitCompatResult>;
export declare function defaultRecoveryDirectory(): string;
