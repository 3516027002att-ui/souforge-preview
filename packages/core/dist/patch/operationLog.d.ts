import type { Diagnostic, FileOperationRecord, OperationLogRecord, OperationStatus, PatchHistoryEntry, PatchProposal } from '@soulforge/shared';
import type { AuditEventRecord, RecoveryPointRecord, ResourceEntryChangeRecord, TransactionJournalPhase, TransactionJournalRecord } from '../storage/durableWorkspaceRepository.js';
import type { GraphPatch } from '@soulforge/shared';
export interface RecordCommittedOperationInput {
    proposal: PatchProposal;
    backupRoot: string;
    files: FileOperationRecord[];
    diagnostics: Diagnostic[];
    graph?: GraphPatch;
}
export interface OperationLogStore {
    record(entry: OperationLogRecord): Promise<void>;
    get(opId: string): Promise<OperationLogRecord | undefined>;
    list(workspaceId?: string): Promise<OperationLogRecord[]>;
    getTransactionForOperation?(opId: string): Promise<TransactionJournalRecord | undefined>;
    findTransactionsForRequest?(sessionName: string, requestId: string): Promise<TransactionJournalRecord[]>;
    updateStatus(opId: string, status: OperationStatus, patch?: Partial<OperationLogRecord>): Promise<OperationLogRecord | undefined>;
    history(workspaceId?: string): Promise<PatchHistoryEntry[]>;
    /** Optional durable journal capabilities supplied by the desktop database utility. */
    createTransaction?(record: Omit<TransactionJournalRecord, 'workspaceId'>): Promise<unknown>;
    transitionTransaction?(options: {
        transactionId: string;
        expectedPhase: TransactionJournalPhase | TransactionJournalPhase[];
        nextPhase: TransactionJournalPhase;
        state: unknown;
        updatedAt?: string;
    }): Promise<TransactionJournalRecord>;
    recordRecoveryPoint?(record: Omit<RecoveryPointRecord, 'workspaceId' | 'recoveryId'> & {
        recoveryId?: string;
    }): Promise<RecoveryPointRecord>;
    appendAuditEvent?(event: Omit<AuditEventRecord, 'workspaceId' | 'eventId'> & {
        eventId?: string;
    }): Promise<AuditEventRecord>;
    recordResourceEntryChange?(record: Omit<ResourceEntryChangeRecord, 'workspaceId'>): Promise<unknown>;
    listResourceEntryChanges?(opId: string): Promise<ResourceEntryChangeRecord[]>;
    finalizeCommit?(bundle: {
        operation: OperationLogRecord;
        resourceEntryChanges: Array<Omit<ResourceEntryChangeRecord, 'workspaceId'>>;
        recoveryPoint: Omit<RecoveryPointRecord, 'workspaceId'>;
        auditEvent: Omit<AuditEventRecord, 'workspaceId'>;
        transactionId: string;
        expectedPhase: TransactionJournalPhase;
        finalState: unknown;
    }): Promise<void>;
}
/**
 * In-memory operation log used until the desktop main process wires SQLite.
 * Semantics match the operation / file rollback model.
 */
export declare class MemoryOperationLogStore implements OperationLogStore {
    private readonly byId;
    private readonly resourceEntryChanges;
    record(entry: OperationLogRecord): Promise<void>;
    get(opId: string): Promise<OperationLogRecord | undefined>;
    list(workspaceId?: string): Promise<OperationLogRecord[]>;
    updateStatus(opId: string, status: OperationStatus, patch?: Partial<OperationLogRecord>): Promise<OperationLogRecord | undefined>;
    recordResourceEntryChange(record: Omit<ResourceEntryChangeRecord, 'workspaceId'>): Promise<void>;
    listResourceEntryChanges(opId: string): Promise<ResourceEntryChangeRecord[]>;
    history(workspaceId?: string): Promise<PatchHistoryEntry[]>;
}
export declare function getDefaultOperationLogStore(): MemoryOperationLogStore;
export declare function toHistoryEntry(entry: OperationLogRecord): PatchHistoryEntry;
export declare function createCommittedOperationRecord(input: RecordCommittedOperationInput): OperationLogRecord;
export declare function createPlannedOperationRecord(proposal: PatchProposal, status?: OperationStatus, diagnostics?: Diagnostic[]): OperationLogRecord;
