import type { OperationLogRecord, PatchHistoryEntry } from '@soulforge/shared';
/**
 * Model-facing projection of a Patch Engine operation.
 *
 * The stored record is the audit authority and keeps absolute machine paths
 * (targetPath / backupRoot / backupPath / recoveryPath). Those must never reach
 * a model: the tool receipt carries logical source URIs plus the hashes that
 * make the transaction checkable, and nothing a transcript cannot publish.
 */
export interface OperationReceiptFile {
    targetUri: string;
    relativePath?: string;
    beforeHash: string;
    afterHash: string;
    kind: string;
    resourceKind?: string;
}
export interface OperationReceipt {
    opId: string;
    title: string;
    author: string;
    mode: string;
    status: string;
    createdAt: string;
    committedAt?: string;
    rolledBackAt?: string;
    transactionId?: string;
    inverseOfOpId?: string;
    rollbackScope?: string;
    rollbackTargetUri?: string;
    files: OperationReceiptFile[];
    diagnostics: unknown[];
}
export declare function projectOperationReceipt(record: OperationLogRecord): OperationReceipt;
export interface PatchHistoryReceipt {
    opId: string;
    title: string;
    author: string;
    mode: string;
    status: string;
    createdAt: string;
    committedAt?: string;
    rolledBackAt?: string;
    fileCount: number;
    inverseOfOpId?: string;
    rollbackScope?: string;
    rollbackTargetUri?: string;
    graphSummary?: unknown;
}
export declare function projectPatchHistoryEntry(entry: PatchHistoryEntry): PatchHistoryReceipt;
/** Logical file URIs restored by a rollback, taken from the committed record. */
export declare function restoredFileUris(record: OperationLogRecord | undefined, restoredFiles: readonly string[]): string[];
/**
 * A session frame embeds the raw OperationLogRecord, which is the audit authority and keeps host
 * paths (targetPath, backupRoot, backupPath) plus the workspace file URL. A client must only ever
 * receive the logical receipt, so project every operation before the frame leaves the host.
 */
export declare function projectSessionTransactionFrame(transaction: unknown): unknown;
