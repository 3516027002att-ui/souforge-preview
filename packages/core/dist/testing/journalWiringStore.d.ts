/**
 * Journal-wired operation-log store for recovery smokes.
 *
 * The plain SQLite operation-log store delegates the optional durable journal
 * methods (`createTransaction` / `transitionTransaction` /
 * `recordRecoveryPoint` / `appendAuditEvent`) to `DurableWorkspaceRepository`
 * and lets `finalizeCommit` run the atomic bundle. This mirrors what the
 * desktop main process wires through `operationLogUtilityClient`, so
 * `executePatchIrThroughTransaction` can drive the full
 * pending -> staging -> validating -> backing_up -> replacing ->
 * marking_committed -> committed phase machine over a real workspace.db.
 */
import type { OperationLogRecord, OperationStatus, PatchHistoryEntry } from '@soulforge/shared';
import type { OperationLogStore } from '../patch/operationLog.js';
import { SqliteOperationLogStore } from '../patch/sqliteOperationLogStore.js';
import { DurableWorkspaceRepository, type AuditEventRecord, type RecoveryPointRecord, type ResourceEntryChangeRecord, type TransactionJournalPhase, type TransactionJournalRecord } from '../storage/durableWorkspaceRepository.js';
import { openWorkspaceDatabase } from '../storage/sqliteDatabase.js';
export declare class JournalWiringStore implements OperationLogStore {
    private readonly delegate;
    readonly repository: DurableWorkspaceRepository;
    constructor(delegate: SqliteOperationLogStore, repository: DurableWorkspaceRepository);
    record(entry: OperationLogRecord): Promise<void>;
    get(opId: string): Promise<OperationLogRecord | undefined>;
    list(workspaceId?: string): Promise<OperationLogRecord[]>;
    updateStatus(opId: string, status: OperationStatus, patch?: Partial<OperationLogRecord>): Promise<OperationLogRecord | undefined>;
    history(workspaceId?: string): Promise<PatchHistoryEntry[]>;
    recordResourceEntryChange(record: Omit<ResourceEntryChangeRecord, 'workspaceId'>): Promise<unknown>;
    listResourceEntryChanges(opId: string): Promise<ResourceEntryChangeRecord[]>;
    createTransaction(record: Omit<TransactionJournalRecord, 'workspaceId'>): Promise<unknown>;
    transitionTransaction(options: {
        transactionId: string;
        expectedPhase: TransactionJournalPhase | TransactionJournalPhase[];
        nextPhase: TransactionJournalPhase;
        state: unknown;
        updatedAt?: string;
    }): Promise<TransactionJournalRecord>;
    recordRecoveryPoint(record: Omit<RecoveryPointRecord, 'workspaceId' | 'recoveryId'> & {
        recoveryId?: string;
    }): Promise<RecoveryPointRecord>;
    appendAuditEvent(event: Omit<AuditEventRecord, 'workspaceId' | 'eventId'> & {
        eventId?: string;
    }): Promise<AuditEventRecord>;
    finalizeCommit(bundle: {
        operation: OperationLogRecord;
        resourceEntryChanges: Array<Omit<ResourceEntryChangeRecord, 'workspaceId'>>;
        recoveryPoint: Omit<RecoveryPointRecord, 'workspaceId'>;
        auditEvent: Omit<AuditEventRecord, 'workspaceId'>;
        transactionId: string;
        expectedPhase: TransactionJournalPhase;
        finalState: unknown;
    }): Promise<void>;
    /** Close the underlying database (session boundary). */
    close(): void;
}
/** Open a workspace database and ensure the workspace row exists. */
export declare function openSessionStore(databasePath: string, workspaceId: string, overlayRoot: string): {
    database: ReturnType<typeof openWorkspaceDatabase>;
    store: JournalWiringStore;
    repository: DurableWorkspaceRepository;
};
