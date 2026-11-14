/**
 * Scene asset inventory projection from MSB scene manifest nodes.
 * Maps parts → model/material candidates without claiming native FLVER.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import type { SceneManifest } from './msbSceneManifest.js';
export type SceneAssetKind = 'model' | 'material' | 'texture' | 'collision' | 'unknown';
export interface SceneAssetRef {
    assetId: string;
    kind: SceneAssetKind;
    label: string;
    /** Relative-style resource label only — never absolute path. */
    resourceLabel: string;
    referencedByPartCount: number;
    partNames: string[];
    authority: 'candidate' | 'fixture-confirmed';
}
export interface SceneAssetInventory {
    sourceUri: string;
    sourcePath: string;
    game: string;
    resourceKind: 'map';
    mapResourceUri: string;
    assets: SceneAssetRef[];
    partCount: number;
    modelCount: number;
    diagnostics: StructuredDiagnostic[];
}
/**
 * Build inventory from an already renderer-safe scene manifest.
 * Without FLVER/material parsers, model refs stay candidate.
 */
export declare function buildSceneAssetInventory(manifest: SceneManifest, options?: {
    maxPartsSampled?: number;
}): SceneAssetInventory;
