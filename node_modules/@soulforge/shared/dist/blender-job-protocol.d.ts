export type BlenderJobState = 'queued' | 'starting' | 'running' | 'exit_observed' | 'artifact_validated' | 'staged' | 'failed' | 'cancelled' | 'timed_out' | 'orphan_cleanup_required';
export type BlenderOperation = 'export_snapshot' | 'apply_placement_delta' | 'export_mesh_channels';
export interface BlenderJobManifest {
    schemaVersion: 1;
    jobId: string;
    exportSessionId: string;
    allowedOperations: BlenderOperation[];
    inputArtifactIds: string[];
    expectedInputHashes: Record<string, string>;
    outputDirectoryHandle: string;
    coordinateProfileHash: string;
    maxOutputBytes: number;
    deadlineAt: number;
    adapterVersion: string;
    operationCount: number;
}
export interface BlenderOutputManifestEntry {
    relativePath: string;
    sha256: string;
    byteLength: number;
}
export interface BlenderResultManifest {
    schemaVersion: 1;
    jobId: string;
    adapterVersion: string;
    coordinateProfileHash: string;
    inputArtifactIds: string[];
    operationCount: number;
    outputs: BlenderOutputManifestEntry[];
    diagnostics: Array<{
        severity: 'info' | 'warning' | 'error';
        code: string;
        message: string;
    }>;
}
export declare function validateBlenderJobManifest(manifest: BlenderJobManifest): void;
export declare function validateBlenderResultManifest(manifest: BlenderResultManifest, expected: Pick<BlenderJobManifest, 'jobId' | 'adapterVersion' | 'coordinateProfileHash' | 'inputArtifactIds' | 'operationCount'>): void;
