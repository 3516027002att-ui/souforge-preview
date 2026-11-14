/**
 * Full File Workbench facade for Files Mode.
 */
import type { ConfirmationReceipt, Diagnostic } from '@soulforge/shared';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import { type FileCapabilityReport } from './fileCapabilities.js';
import { previewFileResource, type FilePreviewResult } from './filePreview.js';
import { readFileResource, type ReadFileResourceResult } from './readFileResource.js';
import { commitFilePatch, proposeRawByteEdit, proposeStructuredEditBlocked, proposeTextFileEdit, proposeWholeFileReplace, type FileWriteProposal } from './writeFileResource.js';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { TransactionCommitCompatResult } from '../patch/durablePatchCommit.js';
export interface OpenFileResourceResult {
    absolutePath: string;
    relativePath: string;
    resourceUri: string;
    exists: boolean;
    capabilities: FileCapabilityReport;
    preview: FilePreviewResult;
    diagnostics: Diagnostic[];
    nativeFormatAuthority: false;
}
export declare function openFileResource(input: {
    session: WorkspaceSession;
    absolutePath?: string;
    relativePath?: string;
    game?: string;
}): Promise<OpenFileResourceResult>;
export declare function getFileCapabilitiesForPath(input: {
    session: WorkspaceSession;
    absolutePath?: string;
    relativePath?: string;
}): Promise<FileCapabilityReport>;
export { readFileResource, previewFileResource, proposeTextFileEdit, proposeRawByteEdit, proposeWholeFileReplace, proposeStructuredEditBlocked, commitFilePatch };
export declare function rollbackFileOperation(input: {
    opId: string;
    store: OperationLogStore;
    session?: WorkspaceSession;
    confirmation?: ConfirmationReceipt;
}): Promise<{
    ok: boolean;
    opId: string;
    restoredFiles: string[];
    diagnostics: Diagnostic[];
}>;
export type { FileWriteProposal, FilePreviewResult, ReadFileResourceResult, TransactionCommitCompatResult };
export declare function commitProposedFileWrite(input: {
    proposal: FileWriteProposal;
    session?: WorkspaceSession;
    workspaceRoot?: string;
    operationLog?: OperationLogStore;
    confirmation?: ConfirmationReceipt;
    backupBaseDir?: string;
    recoveryDir?: string;
}): Promise<TransactionCommitCompatResult>;
