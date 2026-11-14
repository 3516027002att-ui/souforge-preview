import type { OperationLogRecord, OperationStatus, PatchHistoryEntry } from '@soulforge/shared';
import { type OperationLogStore } from './operationLog.js';
/**
 * On-disk operation log implementing the same contract as MemoryOperationLogStore.
 * Persists to a single JSON file so commit / history / rollback survive process reopen.
 * Legacy compatibility store only. Production desktop opens this data through
 * the strict JSON -> workspace.db importer and never writes it again.
 */
export declare class FileOperationLogStore implements OperationLogStore {
    readonly storePath: string;
    private readonly byId;
    constructor(storePath: string);
    /** Re-read the store file. Missing starts empty; corrupt input fails closed. */
    reload(): void;
    record(entry: OperationLogRecord): Promise<void>;
    get(opId: string): Promise<OperationLogRecord | undefined>;
    list(workspaceId?: string): Promise<OperationLogRecord[]>;
    updateStatus(opId: string, status: OperationStatus, patch?: Partial<OperationLogRecord>): Promise<OperationLogRecord | undefined>;
    history(workspaceId?: string): Promise<PatchHistoryEntry[]>;
    private persist;
}
export declare class FileOperationLogCorruptError extends Error {
    readonly storePath: string;
    readonly code = "LEGACY_OPERATION_LOG_CORRUPT";
    constructor(storePath: string, reason: string);
}
/** Open (or create) a file-backed operation log at the given path. */
export declare function openFileOperationLogStore(storePath: string): FileOperationLogStore;
