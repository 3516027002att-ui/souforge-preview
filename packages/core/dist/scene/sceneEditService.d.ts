import type { MapEditTransaction, SceneCapability, SceneDeltaV2, ScenePreviewResult, SceneResourceIdentity, SceneSnapshotObject, SceneSnapshotV2 } from '@soulforge/shared';
import { type CoordinateProfile, type Matrix4 } from './coordinateTransform.js';
import { SceneExportLeaseStore } from './sceneExportLeaseStore.js';
export interface SceneSnapshotObjectInput extends SceneSnapshotObject {
}
export interface CreateSceneSnapshotInput {
    owner: string;
    workspaceId: string;
    sceneResourceIdentity: SceneResourceIdentity;
    snapshotVersion: string;
    coordinateProfile: CoordinateProfile;
    objects: SceneSnapshotObjectInput[];
    assetRefs: SceneSnapshotV2['assetRefs'];
    capabilities: SceneCapability[];
}
export interface PreviewDeltaInput {
    owner: string;
    workspaceId: string;
    snapshot: SceneSnapshotV2;
    delta: SceneDeltaV2;
    coordinateProfile: CoordinateProfile;
}
export declare class SceneEditService {
    private readonly leaseStore;
    constructor(leaseStore: SceneExportLeaseStore);
    exportSnapshot(input: CreateSceneSnapshotInput): SceneSnapshotV2;
    previewDelta(input: PreviewDeltaInput): ScenePreviewResult;
    buildMapTransaction(input: {
        snapshot: SceneSnapshotV2;
        delta: SceneDeltaV2;
        preview: Extract<ScenePreviewResult, {
            ok: true;
        }>;
        coordinateProfile: CoordinateProfile;
    }): MapEditTransaction;
}
export declare function sceneSnapshotMatrixInBlender(snapshot: SceneSnapshotV2, profile: CoordinateProfile, objectHandle: string): Matrix4;
