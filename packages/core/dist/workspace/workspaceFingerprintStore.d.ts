import type { FingerprintContinuityV1, PersistedHashV1 } from './fileFingerprint.js';
export interface LoadStoreArgs {
    workspacePersistentIdentityHash: string;
    storageRoot: string;
    fingerprintStoreGeneration: number;
}
export interface FingerprintStoreState {
    fingerprintStoreGeneration: number;
    hashes: Map<string, PersistedHashV1>;
    pathGenerations: Map<string, number>;
    continuity: FingerprintContinuityV1;
}
export declare function loadFingerprintStore(args: LoadStoreArgs): Promise<FingerprintStoreState>;
export declare function saveFingerprintStore(args: {
    storageRoot: string;
    state: FingerprintStoreState;
}): Promise<void>;
export declare function getPathSourceGeneration(state: FingerprintStoreState, relativePath: string): number;
export declare function bumpPathSourceGeneration(state: FingerprintStoreState, relativePath: string): number;
export declare function verifyContinuityForReuse(continuity: FingerprintContinuityV1): boolean;
/** After a successful full background hash of stable set, promote UNKNOWN -> PROVEN if stable */
export declare function promoteContinuityAfterStableHash(state: FingerprintStoreState): void;
export declare function markCleanShutdown(state: FingerprintStoreState, clean: boolean): void;
export declare function workspacePhysicalRootHash(physicalRoot: string): string;
