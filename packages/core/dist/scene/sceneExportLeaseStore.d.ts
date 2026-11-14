import type { SceneResourceIdentity, SceneSnapshotV2 } from '@soulforge/shared';
export interface SceneExportLease {
    exportSessionId: string;
    owner: string;
    workspaceId: string;
    sourceVersions: Record<string, string>;
    objectAllowlist: string[];
    assetAllowlist: string[];
    coordinateProfileHash: string;
    expiresAt: number;
    closed: boolean;
    sceneResourceIdentity: SceneResourceIdentity;
}
export declare class SceneExportLeaseStore {
    private readonly leases;
    open(input: Omit<SceneExportLease, 'exportSessionId' | 'closed'>): SceneExportLease;
    registerSnapshot(snapshot: SceneSnapshotV2, owner: string): SceneExportLease;
    get(exportSessionId: string): SceneExportLease | undefined;
    requireAuthorized(exportSessionId: string, owner: string, workspaceId: string): SceneExportLease;
    close(exportSessionId: string, owner: string): void;
}
