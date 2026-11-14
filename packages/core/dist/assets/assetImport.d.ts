/**
 * Open-format asset import planner and staging writer.
 * Converts glTF/GLB/PNG/TGA/DDS descriptors into staging artifacts that later
 * feed PatchIR / native container replace. Does not write Mod overlay directly.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
export type AssetImportFormat = 'gltf' | 'glb' | 'png' | 'tga' | 'dds';
export interface AssetImportRequest {
    sourcePath: string;
    sourceBytes?: Buffer;
    targetAssetUri: string;
    conversionRuleId: string;
    stagingRoot: string;
    expectedTargetHash?: string;
}
export interface AssetImportPlan {
    importId: string;
    format: AssetImportFormat;
    sourcePath: string;
    targetAssetUri: string;
    conversionRuleId: string;
    stagingRelativePath: string;
    requiredValidators: string[];
    riskLevel: 'high';
    notes: string[];
}
export interface AssetImportStagingResult {
    ok: boolean;
    plan: AssetImportPlan;
    stagingPath: string;
    contentHash: string;
    byteLength: number;
    diagnostics: StructuredDiagnostic[];
    /** Descriptor consumed by later native conversion / PatchIR steps. */
    stagingManifest: {
        importId: string;
        format: AssetImportFormat;
        targetAssetUri: string;
        conversionRuleId: string;
        contentHash: string;
        byteLength: number;
        sourceFileName: string;
    };
}
export declare function detectAssetImportFormat(filePath: string): AssetImportFormat | null;
export declare function planAssetImport(request: AssetImportRequest): {
    ok: boolean;
    plan?: AssetImportPlan;
    diagnostics: StructuredDiagnostic[];
};
/**
 * Stage import bytes under stagingRoot. Never writes to Mod overlay or base game.
 */
export declare function stageAssetImport(request: AssetImportRequest): Promise<AssetImportStagingResult>;
