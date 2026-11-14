import { type CoverageState } from '../indexing/coverageState.js';
export interface ChrMapLink {
    mapFile: string;
    mapId: string;
    partName: string;
    eventFile: string;
    /** Physical MSB instance identity; never collapse same-model instances. */
    entityId?: number;
    internalEntryId?: number;
    model?: string;
    modelIndex?: number;
    entityGroupId?: number;
    identityStatus: 'native-foreign-key' | 'model-name-match' | 'unverified';
}
export interface ChrBossEventLink {
    mapFile: string;
    eventFile: string;
    eventId: number;
    role?: string;
    instructionName: string;
    keyInstructions?: string[];
    description: string;
    /** Event naming/instruction evidence does not prove reward causality. */
    causality: 'scope-only' | 'defeat-handler-observed' | 'unverified';
    entityIds?: number[];
}
export interface ChrLinkageEdge {
    ruleId: string;
    fromUri: string;
    toUri: string;
    sourceProperty: string;
    targetNamespace: string;
    sourceSnapshot: {
        sourceUri: string;
        sourceRevision?: number;
    };
    targetConfirmed: boolean;
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
}
export interface ChrReadPlanStep {
    stepId: string;
    target: string;
    reason: string;
    requiredForMutation: boolean;
}
export interface ChrLinkageResult {
    characterId: string;
    npcParamId: number;
    maps: ChrMapLink[];
    associatedBossEvents: ChrBossEventLink[];
    scripts: string[];
    coverage: CoverageState;
    coverageByDomain: CoverageState[];
    verifiedEdges: ChrLinkageEdge[];
    blockedReasons: string[];
    nextReadPlan: ChrReadPlanStep[];
}
/**
 * Extracts the 4-digit character model code from an NpcParam rowId.
 * Sekiro standard:
 *   50800000 -> c5080 (Gyoubu)
 *   10200000 -> c1020 (General)
 *   10700000 -> c1070 (Juzou)
 *   54000000 -> c5400 (Genichiro)
 */
export declare function extractChrId(rowId: number): string | null;
export interface ResolveChrLinkageOptions {
    workspaceRoot: string;
    oodleRuntimeRoot?: string | undefined;
    bridgeExecutablePath?: string | undefined;
}
/**
 * Resolves all associated maps, EMEVD event files, boss UI events, and Lua scripts
 * for a given NpcParam rowId.
 */
export declare function resolveChrLinkage(rowId: number, options: ResolveChrLinkageOptions): Promise<ChrLinkageResult | null>;
