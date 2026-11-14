/**
 * Raw-level write entry for any file via PatchIR + WorkspaceTransaction.
 * High-risk for native/packed; always requires confirmation for raw ops.
 * Not a native semantic writer.
 */
import type { ConfirmationReceipt, IndexedFile, SaveTextResourceResult } from '@soulforge/shared';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
export type SaveRawResourceResult = SaveTextResourceResult & {
    kind?: 'raw_file_replace' | 'raw_byte_range';
};
export interface SaveRawReplaceOptions {
    file: IndexedFile;
    expectedHash: string;
    newContentBase64: string;
    allowEmpty?: boolean;
    confirmation?: ConfirmationReceipt;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
    title?: string;
}
export interface SaveRawByteRangeOptions {
    file: IndexedFile;
    expectedHash: string;
    offset: number;
    length: number;
    replacementBase64: string;
    confirmation?: ConfirmationReceipt;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
    title?: string;
}
export declare function saveRawReplace(options: SaveRawReplaceOptions): Promise<SaveRawResourceResult>;
export declare function saveRawByteRange(options: SaveRawByteRangeOptions): Promise<SaveRawResourceResult>;
