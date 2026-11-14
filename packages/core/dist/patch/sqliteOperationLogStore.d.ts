import type { OperationLogRecord, OperationStatus, PatchHistoryEntry } from '@soulforge/shared';
import type { SqliteDatabase } from '../storage/sqliteDatabase.js';
import { type OperationLogStore } from './operationLog.js';
import { type AuditEventRecord, type RecoveryPointRecord, type ResourceEntryChangeRecord, type TransactionJournalPhase, type TransactionJournalRecord } from '../storage/durableWorkspaceRepository.js';
export interface OpenSqliteOperationLogStoreOptions {
    databasePath: string;
    workspaceId: string;
    rootPath: string;
    game?: string;
    nativeBinding?: string;
}
export interface LegacyImportLedgerEntry {
    sourceKind: string;
    sourcePathHash: string;
    contentHash: string;
    importedAt: string;
    recordCount: number;
    backupPath: string;
}
export declare class SqliteOperationLogStore implements OperationLogStore {
    readonly database: SqliteDatabase;
    readonly workspaceId: string;
    private readonly ownsDatabase;
    constructor(database: SqliteDatabase, workspaceId: string, ownsDatabase?: boolean);
    record(entry: OperationLogRecord): Promise<void>;
    get(opId: string): Promise<OperationLogRecord | undefined>;
    getTransactionForOperation(opId: string): Promise<TransactionJournalRecord | undefined>;
    findTransactionsForRequest(sessionName: string, requestId: string): Promise<TransactionJournalRecord[]>;
    list(workspaceId?: string): Promise<OperationLogRecord[]>;
    updateStatus(opId: string, status: OperationStatus, patch?: Partial<OperationLogRecord>): Promise<OperationLogRecord | undefined>;
    history(workspaceId?: string): Promise<PatchHistoryEntry[]>;
    recordResourceEntryChange(record: Omit<ResourceEntryChangeRecord, 'workspaceId'>): Promise<void>;
    listResourceEntryChanges(opId: string): Promise<ResourceEntryChangeRecord[]>;
    finalizeCommit(bundle: Parameters<NonNullable<OperationLogStore['finalizeCommit']>>[0]): Promise<void>;
    /**
     * Durable journal capabilities backed by the same workspace.db connection.
     *
     * Implementing these directly on the core store makes the full journal phase
     * machine (pending -> staging -> validating -> backing_up -> replacing ->
     * marking_committed -> committed / rolled_back / failed) runnable on the core
     * path with a plain `SqliteOperationLogStore`, without requiring the desktop
     * database utility client (W-A-RECOVERY-INTEGRATION-04 core wiring).
     */
    createTransaction(record: Omit<TransactionJournalRecord, 'workspaceId'>): Promise<null>;
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
    hasLegacyImport(sourceKind: string, sourcePathHash: string, contentHash: string): boolean;
    importLegacyRecords(records: readonly OperationLogRecord[], ledger: LegacyImportLedgerEntry): void;
    close(): void;
    private durableRepository;
    private writeRecord;
    private hydrate;
    private assertWorkspace;
}
export declare function openSqliteOperationLogStore(options: OpenSqliteOperationLogStoreOptions): SqliteOperationLogStore;
