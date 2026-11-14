import type { ConfirmationReceipt, IndexedFile, SaveTextResourceResult } from '@soulforge/shared';
import { type OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
export interface SaveTextResourceOptions {
    file: IndexedFile;
    newText: string;
    allowEmpty?: boolean;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
    /** Required when writer contract / risk assessment demands confirmation. */
    confirmation?: ConfirmationReceipt;
    /** Preview-derived risk signals from desktop / tools. */
    truncated?: boolean;
    structuredEditable?: boolean;
    parseStatus?: string;
}
/**
 * Saves a directly editable text resource through PatchIR + WorkspaceTransaction.
 *
 * Production path:
 *   writer gate → PatchProposal → PatchIR → WorkspaceTransaction
 *     (addPatch → stage → validate → commit) → operation log
 *
 * Does not write the target file outside WorkspaceTransaction.commit.
 * Native packed formats remain blocked by the writer gate.
 */
export declare function saveTextResource(options: SaveTextResourceOptions): Promise<SaveTextResourceResult>;
