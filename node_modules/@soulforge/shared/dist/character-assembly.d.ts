import type { Diagnostic } from './types.js';
export type AssemblyProvenance = {
    kind: 'param-field';
    paramUri: string;
    table: string;
    rowIndex: number;
    fieldId: string;
    expectedDataHash: string;
} | {
    kind: 'explicit-selection';
    selectionEventId: string;
    selectedResourceUri: string;
};
export interface CharacterAssemblyContext {
    leaderModelUri: string;
    leaderProvenance: AssemblyProvenance;
    bodyParts: Array<{
        slot: string;
        resourceUri: string;
        provenance: AssemblyProvenance;
    }>;
    attachments: Array<{
        resourceUri: string;
        attachBoneName: string;
        provenance: AssemblyProvenance;
    }>;
    workspaceGeneration: number;
}
export interface AnimationPlaybackContext {
    animationContainerUri: string;
    skeletonContainerUri: string;
    animationId: number;
    animationProvenance: AssemblyProvenance;
    skeletonProvenance: AssemblyProvenance;
    workspaceGeneration: number;
}
export interface CharacterAssemblyResult {
    ok: boolean;
    diagnostics: Diagnostic[];
}
export declare function isAssemblyProvenance(value: unknown): value is AssemblyProvenance;
export declare function isCharacterAssemblyContext(value: unknown): value is CharacterAssemblyContext;
export declare function isAnimationPlaybackContext(value: unknown): value is AnimationPlaybackContext;
