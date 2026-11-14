import type { SqliteDatabase } from '../storage/sqliteDatabase.js';
export interface LegacySemanticSnapshotImportOptions {
    sourcePath: string;
    backupDirectory: string;
    database: SqliteDatabase;
    workspaceId: string;
}
export interface LegacySemanticSnapshotImportResult {
    status: 'archived' | 'already_imported' | 'source_missing';
    nodeCount: number;
    edgeCount: number;
    contentHash?: string;
    backupPath?: string;
}
export declare class LegacySemanticSnapshotImportError extends Error {
    readonly code: string;
    readonly details?: unknown | undefined;
    constructor(code: string, message: string, details?: unknown | undefined);
}
export declare function importLegacySemanticSnapshot(options: LegacySemanticSnapshotImportOptions): Promise<LegacySemanticSnapshotImportResult>;
