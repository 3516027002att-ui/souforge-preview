/**
 * Backup / restore-point scaffold.
 */
export interface BackupFileEntry {
    sourcePath: string;
    backupPath: string;
    beforeHash: string;
    sizeBytes: number;
}
export interface RestorePoint {
    restorePointId: string;
    root: string;
    createdAt: string;
    files: BackupFileEntry[];
    sizeBytes: number;
    metadataPath: string;
}
export declare function createRestorePoint(input: {
    sourcePaths: string[];
    baseDir?: string;
    label?: string;
}): Promise<RestorePoint>;
export declare function restoreFromPoint(restorePoint: RestorePoint): Promise<{
    ok: boolean;
    restoredPaths: string[];
    errors: string[];
}>;
