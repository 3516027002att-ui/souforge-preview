import type { AuditLogEntry, AuditLogStore } from '@soulforge/shared';
export declare class MemoryAuditLogStore implements AuditLogStore {
    private readonly entries;
    append(entry: AuditLogEntry): void;
    list(filter?: {
        transactionId?: string;
        operationId?: string;
        patchId?: string;
        limit?: number;
    }): AuditLogEntry[];
    clear(): void;
}
/**
 * JSONL audit log on disk (SQLite-ready interface, file-backed).
 */
export declare class JsonlAuditLogStore implements AuditLogStore {
    private readonly filePath;
    private readonly cache;
    private loaded;
    constructor(filePath: string);
    append(entry: AuditLogEntry): void;
    appendAsync(entry: AuditLogEntry): Promise<void>;
    list(filter?: {
        transactionId?: string;
        operationId?: string;
        patchId?: string;
        limit?: number;
    }): AuditLogEntry[];
    load(): Promise<void>;
    private persistLine;
}
export declare function createAuditEntry(partial: Omit<AuditLogEntry, 'entryId' | 'timestamp' | 'diagnostics' | 'affectedResources' | 'confirmationReceipts'> & {
    diagnostics?: AuditLogEntry['diagnostics'];
    affectedResources?: string[];
    confirmationReceipts?: AuditLogEntry['confirmationReceipts'];
    timestamp?: string;
}): AuditLogEntry;
export declare function writeAuditSnapshot(filePath: string, entries: readonly AuditLogEntry[]): Promise<void>;
