import type { ConfirmationReceipt, IndexedFile, NativeEditDomain, ResourceKind } from '@soulforge/shared';
import { type OperationLogStore } from '../patch/operationLog.js';
import { type WorkspaceSession } from '../workspace/workspaceSession.js';
import type { RawReplaceCommitPort, WriteConfirmationPort } from './editorMutationService.js';
export interface HostNativeHandleEntry {
    handle: string;
    sourceUri: string;
    domain: NativeEditDomain;
    sourceHash: string;
    sourceRevision?: number | string;
    readFields: Set<string>;
    requiredFields?: Set<string>;
    createdAt: number;
}
export interface NativeEditSession {
    session: WorkspaceSession;
    operationLog: OperationLogStore;
    stagingRoot: string;
    backupBaseDir: string;
    recoveryDir: string;
    oodleRuntimeRoot?: string;
    confirmationPort?: WriteConfirmationPort;
    commitPort: RawReplaceCommitPort;
    allowedRoots(): string[];
    mintReceipt(sourceUri: string, title: string): ConfirmationReceipt;
    indexFile(absolutePath: string, kind?: ResourceKind): Promise<IndexedFile>;
    registerReadHandle(entry: HostNativeHandleEntry): void;
    resolveReadHandle(handle: string): HostNativeHandleEntry | undefined;
    verifyReadCoverage(handle: string, requiredFields: string[]): {
        ok: true;
    } | {
        ok: false;
        code: string;
        message: string;
    };
}
export interface OpenNativeEditSessionOptions {
    overlayRoot: string;
    baseRoot?: string;
    game?: string;
    operationLog?: OperationLogStore;
}
export declare function nativeEditSessionFromContext(input: {
    session: WorkspaceSession;
    operationLog: OperationLogStore;
    backupBaseDir: string;
    recoveryDir: string;
    stagingRoot?: string;
    confirmation?: ConfirmationReceipt;
    confirmationPort?: WriteConfirmationPort;
}): NativeEditSession;
export declare function openNativeEditSession(options: OpenNativeEditSessionOptions): Promise<NativeEditSession>;
export declare function mintNativeEditReceipt(sourceUri: string, title: string): ConfirmationReceipt;
export declare function indexOverlayFile(session: WorkspaceSession, absolutePath: string, kind?: ResourceKind): Promise<IndexedFile>;
