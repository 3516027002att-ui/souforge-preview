/**
 * MSB Bridge stage helpers for part/region transform writes.
 */
export type MsbBridgeMutation = {
    kind: 'set_part_position' | 'set_part_transform' | 'set_region_position' | 'set_region_transform';
    family: 'part' | 'region';
    nativeOffset: number;
    expectedName?: string;
    posX?: number;
    posY?: number;
    posZ?: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
} | {
    kind: 'change_model' | 'set_part_model';
    family: 'part';
    nativeOffset: number;
    expectedName?: string;
    modelName?: string;
    modelIndex?: number;
} | {
    kind: 'set_property' | 'set_entity_id';
    family: 'part' | 'region';
    nativeOffset: number;
    expectedName?: string;
    entityId: number;
} | {
    kind: 'delete_part' | 'delete_region' | 'delete_event';
    family: 'part' | 'region' | 'event';
    nativeOffset: number;
    expectedName?: string;
} | {
    /** Legacy IPC shape is accepted only so callers compile; serializer rejects it. */
    kind: 'set_part_position' | 'set_part_transform' | 'set_region_position' | 'delete_part' | 'delete_region' | 'delete_event';
    partName: string;
    posX?: number;
    posY?: number;
    posZ?: number;
    rotX?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
};
export interface MsbBridgeCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutation?: MsbBridgeMutation | undefined;
    mutations?: MsbBridgeMutation[] | undefined;
    oodleRuntimeRoot?: string | undefined;
    timeoutMs?: number | undefined;
}
export interface MsbBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    partCount?: number;
    regionCount?: number;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export declare function commitMsbMutationViaBridge(request: MsbBridgeCommitRequest): Promise<MsbBridgeCommitResult>;
