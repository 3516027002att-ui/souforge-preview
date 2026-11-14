import type { SqliteOperationLogStore } from './sqliteOperationLogStore.js';
export interface ImportLegacyOperationLogOptions {
    sourcePath: string;
    backupDirectory: string;
    store: SqliteOperationLogStore;
}
export interface ImportLegacyOperationLogResult {
    status: 'imported' | 'already_imported' | 'source_missing';
    recordCount: number;
    contentHash?: string;
    backupPath?: string;
}
export declare class LegacyOperationLogImportError extends Error {
    readonly code: string;
    readonly details?: unknown | undefined;
    constructor(code: string, message: string, details?: unknown | undefined);
}
/**
 * Strict, idempotent JSON → workspace.db importer.
 * Corrupt input is surfaced and left untouched; it is never converted to an
 * empty history. A validated read-only backup is created before the DB commit.
 */
export declare function importLegacyOperationLog(options: ImportLegacyOperationLogOptions): Promise<ImportLegacyOperationLogResult>;
