/**
 * replaceContainerChild entry — PatchIR container_child_replace + WorkspaceTransaction.
 */
import type { ConfirmationReceipt, IndexedFile, SaveTextResourceResult } from '@soulforge/shared';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
export interface ReplaceContainerChildOptions {
    file: IndexedFile;
    childUri: string;
    expectedContainerHash: string;
    expectedChildHash: string;
    newContentBase64: string;
    confirmation?: ConfirmationReceipt;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
    title?: string;
}
export type ReplaceContainerChildResult = SaveTextResourceResult & {
    kind: 'container_child_replace';
    childUri?: string;
};
export declare function replaceContainerChild(options: ReplaceContainerChildOptions): Promise<ReplaceContainerChildResult>;
export declare function inspectContainerForFile(file: IndexedFile): Promise<import("../index.js").ContainerReadResult>;
export declare function readContainerChildForFile(file: IndexedFile, childUri: string): Promise<import("../index.js").ChildBytesResult>;
