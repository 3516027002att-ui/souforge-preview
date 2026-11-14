import type { ResourceKind, ScanProgress, WorkspaceScanResult } from '@soulforge/shared';
export interface ScanWorkspaceOptions {
    workspaceRoot: string;
    game?: string;
    includeKinds?: readonly ResourceKind[];
    /**
     * Content hashes are expensive enrichment, not directory-discovery data.
     * Keep the default for existing verification/write paths; the desktop open
     * path explicitly disables it and hydrates hashes in a cancellable job.
     */
    includeContentHashes?: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: ScanProgress) => void;
}
export declare function scanWorkspace(options: ScanWorkspaceOptions): Promise<WorkspaceScanResult>;
