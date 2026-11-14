import type { OperationLogRecord } from '@soulforge/shared';
import type { OperationLogStore } from '../patch/operationLog.js';
export type TransactionOutcomeState = 'not_committed' | 'committed' | 'unknown' | 'recovery_required' | 'rolled_back';
export interface OperationOutcome {
    opId: string;
    state: TransactionOutcomeState;
    operation?: OperationLogRecord;
}
export interface SessionTransactionOutcome {
    state: TransactionOutcomeState;
    /** The single committed operation's id; absent when the request committed several (see `opIds`). */
    opId?: string;
    /**
     * Every operation this request committed, in start order. A writer that commits one
     * operation per table (PARAM cross-table edits) has no single `opId`; without this array a
     * caller keyed on `transaction.opId` has no rollback handle and must reverse the operation
     * log by title/time. Each entry is individually rollable; roll back later ones first.
     */
    opIds?: string[];
    operations: OperationOutcome[];
}
export interface OperationRequestIdentity {
    sessionName: string;
    id: string;
    payloadHash: string;
}
export declare function trackRequestOperations<T>(observe: (opId: string, store: OperationLogStore) => void, execute: () => Promise<T>, identity?: OperationRequestIdentity): Promise<T>;
export declare function noteOperationStarted(opId: string, store: OperationLogStore): void;
/** Correlation is metadata in the existing journal, preserved through every phase. */
export declare function journalStateWithRequest(state: unknown): unknown;
/** Query authoritative state. Missing receipts and transport failure are unknown. */
export declare function queryOperationOutcome(store: OperationLogStore, opId: string): Promise<OperationOutcome>;
export declare function summarizeOperationOutcomes(operations: OperationOutcome[], notStarted?: boolean): SessionTransactionOutcome;
/** Known executor receipt fields only; never model text or a tool-name heuristic. */
export declare function receiptOperationIds(value: unknown): string[];
