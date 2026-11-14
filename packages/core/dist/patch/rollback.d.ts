import type { ConfirmationReceipt, Diagnostic, OperationLogRecord } from '@soulforge/shared';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { OperationLogStore } from './operationLog.js';
/**
 * 回滚阶段的可判定分类。它只比较当前文件与本事务的 before/after image，
 * 不会把第三种版本覆盖掉；供恢复扫描与 UI 共同使用。
 */
export type RollbackReconciliation = 'NOOP' | 'NOT_APPLIED' | 'APPLIED' | 'CONFLICT';
export declare function classifyRollbackState(beforeHash: string, afterHash: string, currentHash: string): RollbackReconciliation;
export declare function rollbackIdempotencyKey(operationId: string, scope: 'operation' | 'file' | 'resource_entry', target?: string): string;
export declare function assertRollbackMayWrite(state: RollbackReconciliation, target: string): void;
export interface RollbackOperationOptions {
    opId: string;
    store: OperationLogStore;
    /** Optional explicit workspace root for CLI/core callers without a session object. */
    workspaceRoot?: string;
    session?: WorkspaceSession;
    backupBaseDir?: string;
    recoveryDir?: string;
    author?: 'user' | 'ai';
    confirmation?: ConfirmationReceipt;
}
export interface RollbackOperationResult {
    ok: boolean;
    /** Original operation requested by the caller. */
    opId: string;
    /** Newly committed inverse transaction, when successful. */
    inverseOpId?: string;
    restoredFiles: string[];
    diagnostics: Diagnostic[];
    record?: OperationLogRecord;
}
export interface RollbackFileOptions extends RollbackOperationOptions {
    targetUri: string;
}
export interface RollbackResourceEntryOptions extends RollbackOperationOptions {
    entryUri: string;
}
/**
 * Operation-level rollback implemented as a new inverse PatchIR transaction.
 *
 * The original operation record is immutable. The inverse transaction repeats
 * the normal staging, validation, backup, atomic replace, reread and durable log
 * path, and records `inverseOfOpId`. Inverse transactions are deliberately
 * terminal: allowing a rollback of a rollback would create an unbounded
 * inverse chain and make the logical operation history ambiguous.
 */
export declare function rollbackOperation(options: RollbackOperationOptions): Promise<RollbackOperationResult>;
/** File-level rollback uses the same inverse PatchIR transaction as operation rollback. */
export declare function rollbackFile(options: RollbackFileOptions): Promise<RollbackOperationResult>;
/** Roll back one recorded container/resource entry through its persisted inverse PatchIR op. */
export declare function rollbackResourceEntry(options: RollbackResourceEntryOptions): Promise<RollbackOperationResult>;
