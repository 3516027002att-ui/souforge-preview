/**
 * Durable journal recovery repair (A-RECOVERY, W-A-RECOVERY-INTEGRATION-04).
 *
 * Consumes `listIncompleteTransactions()` — journal rows whose phase is not
 * terminal (`committed` / `rolled_back` / `failed`) — after a hard process
 * termination and reconciles the workspace back to a consistent, terminal
 * state:
 *
 * - When the journal row carries backup metadata (persisted by
 *   `durablePatchCommit` in the `backing_up -> replacing` transition, before any
 *   target is replaced), each target is first checked for whole-file integrity
 *   (its hash must equal either the before or the recorded after hash). Originals
 *   are then restored from the backup and the restored hashes re-verified.
 * - Leftover `.soulforge-<txid>-<name>.tmp` sibling files from an interrupted
 *   replace loop are removed.
 * - When no backup metadata exists (termination before the restore point was
 *   durable), files are untouched and the transaction is simply marked failed.
 * - Corruption or restore failure is fail-closed: the journal row is left
 *   non-terminal and a structured error diagnostic is returned so a caller can
 *   escalate instead of silently destroying evidence.
 *
 * This is an explicit recovery entry point for a caller (e.g. the main process
 * on session restart). It never auto-replays requests and never performs
 * roll-forward; the safe default is roll-back-to-before.
 */
import type { Diagnostic } from '@soulforge/shared';
import type { AuditEventRecord, TransactionJournalPhase, TransactionJournalRecord } from '../storage/durableWorkspaceRepository.js';
import type { OperationLogStore } from './operationLog.js';
export type RecoveryAction = 'rolled_back' | 'marked_failed' | 'corruption_blocked' | 'restore_failed';
export interface RecoveredTransaction {
    transactionId: string;
    opId: string;
    phase: TransactionJournalPhase;
    action: RecoveryAction;
    restoredFiles: string[];
    removedTempFiles: string[];
    corruptionDetected: boolean;
    journalState: Record<string, unknown>;
}
export interface RecoveryRepairResult {
    recovered: RecoveredTransaction[];
    diagnostics: Diagnostic[];
}
/**
 * The minimal durable-journal surface `recoverIncompleteTransactions` needs.
 *
 * `DurableWorkspaceRepository` (synchronous, one workspace.db connection)
 * satisfies it directly. The desktop main process's async database utility
 * client also satisfies it, so the same recovery entry can be driven from the
 * main process on restart without duplicating the repair logic.
 */
export interface RecoverableJournalRepository {
    listIncompleteTransactions(): TransactionJournalRecord[] | Promise<TransactionJournalRecord[]>;
    transitionTransaction(options: {
        transactionId: string;
        expectedPhase: TransactionJournalPhase | TransactionJournalPhase[];
        nextPhase: TransactionJournalPhase;
        state: unknown;
        updatedAt?: string;
    }): TransactionJournalRecord | Promise<TransactionJournalRecord>;
    appendAuditEvent(event: Omit<AuditEventRecord, 'workspaceId' | 'eventId'> & {
        eventId?: string;
    }): AuditEventRecord | Promise<AuditEventRecord>;
}
/**
 * Reconcile every non-terminal journal row for a workspace back to a terminal
 * state. Idempotent: a second call finds nothing to repair.
 *
 * A corrupt journal row (unparseable `state_json` / invalid phase) makes the
 * whole non-terminal list unreadable; the pass then fails closed with a
 * structured `RECOVERY_JOURNAL_READ_FAILED` diagnostic and repairs nothing, so
 * the corruption is surfaced instead of being silently skipped.
 */
export declare function recoverIncompleteTransactions(options: {
    store: OperationLogStore;
    repository: RecoverableJournalRepository;
}): Promise<RecoveryRepairResult>;
