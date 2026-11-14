/**
 * Patch impact computation (core only — no UI).
 */
import type { PatchIR, StructuredDiagnostic } from '@soulforge/shared';
import type { MemoryResourceGraph } from '../resource-graph/memoryResourceGraph.js';
export interface PatchImpactGraph {
    patchId: string;
    changedResources: string[];
    changedFieldsOrRanges: Array<{
        targetUri: string;
        kind: string;
        detail: string;
    }>;
    directReferenceImpact: string[];
    reverseReferenceImpact: string[];
    candidateRiskEdges: Array<{
        edgeId: string;
        reason: string;
    }>;
    confirmedEdges: Array<{
        edgeId: string;
        reason: string;
    }>;
    validatorsToRun: string[];
    confidenceBreakdown: {
        candidateCount: number;
        confirmedCount: number;
    };
    rollbackScope: string[];
    operationLogScope: string[];
    reindexTargets: string[];
    diagnostics: StructuredDiagnostic[];
}
export declare function buildPatchImpactGraph(patch: PatchIR, graph?: MemoryResourceGraph): PatchImpactGraph;
