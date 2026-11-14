/**
 * Files Mode write proposals and commits through PatchIR + WorkspaceTransaction only.
 */
import type { ConfirmationReceipt, Diagnostic, PatchIR, PatchIrOperation, StructuredDiagnostic } from '@soulforge/shared';
import { type ExecutePatchIrOptions, type TransactionCommitCompatResult } from '../patch/durablePatchCommit.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import { type FileCapabilityReport } from './fileCapabilities.js';
export interface FileWriteProposal {
    proposalId: string;
    patch: PatchIR;
    capabilities: FileCapabilityReport;
    riskLevel: PatchIrOperation['riskLevel'];
    requiresConfirmation: boolean;
    diagnostics: StructuredDiagnostic[];
}
export interface ProposeTextFileEditInput {
    workspaceId: string;
    absolutePath: string;
    relativePath?: string;
    newText: string;
    allowEmpty?: boolean;
    session?: WorkspaceSession;
    title?: string;
}
export interface ProposeRawByteEditInput {
    workspaceId: string;
    absolutePath: string;
    relativePath?: string;
    offset: number;
    length: number;
    replacement: Buffer | Uint8Array;
    /**
     * Caller-owned content hash precondition. Must not be recomputed/overwritten
     * when provided (TOCTOU protection for raw write path).
     */
    expectedHash: string;
    session?: WorkspaceSession;
    title?: string;
}
export interface ProposeWholeFileReplaceInput {
    workspaceId: string;
    absolutePath: string;
    relativePath?: string;
    newText?: string;
    newContentBase64?: string;
    allowEmpty?: boolean;
    allowCreateNewFile?: boolean;
    /**
     * When set for an existing file, this hash is used as the PatchIR precondition
     * and must not be recomputed from disk at proposal time.
     */
    expectedHash?: string;
    session?: WorkspaceSession;
    title?: string;
    confirmation?: ConfirmationReceipt;
}
export declare function proposeTextFileEdit(input: ProposeTextFileEditInput): Promise<FileWriteProposal>;
export declare function proposeRawByteEdit(input: ProposeRawByteEditInput): Promise<FileWriteProposal>;
export declare function proposeWholeFileReplace(input: ProposeWholeFileReplaceInput): Promise<FileWriteProposal>;
export declare function commitFilePatch(input: {
    patch: PatchIR;
    session?: WorkspaceSession;
    workspaceRoot?: string;
    operationLog?: ExecutePatchIrOptions['operationLog'];
    confirmation?: ConfirmationReceipt;
    backupBaseDir?: string;
    recoveryDir?: string;
}): Promise<TransactionCommitCompatResult & {
    diagnostics: Diagnostic[];
}>;
export declare function proposeStructuredEditBlocked(input: {
    absolutePath: string;
    relativePath: string;
}): FileWriteProposal;
