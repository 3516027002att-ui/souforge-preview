import type { SqliteDatabase } from './sqliteDatabase.js';
import type { PatchIrOperation } from '@soulforge/shared';
export type TransactionJournalPhase = 'pending' | 'staging' | 'validating' | 'backing_up' | 'replacing' | 'after_commit_validation' | 'marking_committed' | 'committed' | 'rolling_back' | 'rolled_back' | 'recovery_required' | 'failed';
export interface TransactionJournalRecord<TState = unknown> {
    transactionId: string;
    workspaceId: string;
    opId: string;
    phase: TransactionJournalPhase;
    state: TState;
    createdAt: string;
    updatedAt: string;
}
export interface RecoveryPointRecord<TMetadata = unknown> {
    recoveryId: string;
    workspaceId: string;
    opId?: string;
    rootPath: string;
    sizeBytes: number;
    state: 'active' | 'restored' | 'expired' | 'failed';
    createdAt: string;
    expiresAt?: string;
    metadata: TMetadata;
}
export interface AuditEventRecord<TPayload = unknown> {
    eventId: string;
    workspaceId: string;
    eventKind: string;
    opId?: string;
    transactionId?: string;
    payload: TPayload;
    createdAt: string;
}
export interface ResourceEntryChangeRecord {
    id: string;
    workspaceId: string;
    opId: string;
    resourceUri: string;
    entryUri: string;
    changeKind: string;
    beforeHash?: string;
    afterHash?: string;
    inverse: PatchIrOperation;
}
export interface RecoveryCleanupPlan {
    candidates: Array<RecoveryPointRecord & {
        reason: 'expired' | 'age' | 'quota';
    }>;
    protectedRecoveryIds: string[];
    activeBytesBefore: number;
    projectedBytesAfter: number;
    quotaSatisfied: boolean;
}
/** Durable transaction, recovery, and audit access over one workspace.db connection. */
export declare class DurableWorkspaceRepository {
    private readonly database;
    readonly workspaceId: string;
    constructor(database: SqliteDatabase, workspaceId: string);
    createTransaction<TState>(record: Omit<TransactionJournalRecord<TState>, 'workspaceId'>): void;
    transitionTransaction<TState>(options: {
        transactionId: string;
        expectedPhase: TransactionJournalPhase | readonly TransactionJournalPhase[];
        nextPhase: TransactionJournalPhase;
        state: TState;
        updatedAt?: string;
    }): TransactionJournalRecord<TState>;
    getTransaction<TState = unknown>(transactionId: string): TransactionJournalRecord<TState> | undefined;
    getTransactionForOperation(opId: string): TransactionJournalRecord | undefined;
    findTransactionsForRequest(sessionName: string, requestId: string): TransactionJournalRecord[];
    listIncompleteTransactions(): TransactionJournalRecord[];
    recordRecoveryPoint<TMetadata>(record: Omit<RecoveryPointRecord<TMetadata>, 'workspaceId' | 'recoveryId'> & {
        recoveryId?: string;
    }): RecoveryPointRecord<TMetadata>;
    listRecoveryPoints(): RecoveryPointRecord[];
    planRecoveryCleanup(options?: {
        now?: Date;
        maxAgeDays?: number;
        maxBytes?: number;
    }): RecoveryCleanupPlan;
    markRecoveryPointExpired(recoveryId: string): void;
    appendAuditEvent<TPayload>(event: Omit<AuditEventRecord<TPayload>, 'workspaceId' | 'eventId'> & {
        eventId?: string;
    }): AuditEventRecord<TPayload>;
    listAuditEvents(): AuditEventRecord[];
    recordResourceEntryChange(record: Omit<ResourceEntryChangeRecord, 'workspaceId'>): void;
    listResourceEntryChanges(opId: string): ResourceEntryChangeRecord[];
}
