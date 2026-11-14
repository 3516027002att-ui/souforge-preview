/**
 * Legacy patchEngine production path → PatchIR + WorkspaceTransaction.
 *
 * This is the single real commit authority bridge for old PatchProposal callers.
 * createStagingArea remains for dry-run / graph prep only; commit always
 * re-executes through WorkspaceTransaction + durable operation log recovery.
 */
import type { PatchProposal, ValidationResult } from '@soulforge/shared';
import { type WorkspaceTransaction } from '../transactions/workspaceTransaction.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { OperationLogStore } from './operationLog.js';
import { type TransactionCommitCompatResult } from './durablePatchCommit.js';
export type { TransactionCommitCompatResult };
export interface ExecutePatchProposalOptions {
    workspaceRoot?: string;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    actorId?: string;
    recoveryDir?: string;
}
/**
 * Production write path for legacy proposals:
 * PatchProposal → PatchIR → durable WorkspaceTransaction + operation log recovery.
 */
export declare function executePatchProposalThroughTransaction(proposal: PatchProposal, options?: ExecutePatchProposalOptions): Promise<TransactionCommitCompatResult>;
/**
 * Stage + validate only (no commit). Used by dry-run compatibility.
 */
export declare function stageAndValidateProposalThroughTransaction(proposal: PatchProposal, options?: ExecutePatchProposalOptions): Promise<ValidationResult & {
    transaction?: WorkspaceTransaction;
}>;
export declare function resolveWorkspaceRoot(proposal: PatchProposal, options: ExecutePatchProposalOptions): string | undefined;
export declare function resolveWorkspaceRootFromAbsoluteAndRelative(absolutePath: string, relativePath: string): string;
/** Map legacy commit options into ExecutePatchProposalOptions. */
export declare function toExecuteOptions(options: {
    workspaceRoot?: string;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupRoot?: string;
    recoveryDir?: string;
}): ExecutePatchProposalOptions;
