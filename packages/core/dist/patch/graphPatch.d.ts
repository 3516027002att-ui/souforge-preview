import type { GraphPatch, PatchChange, PatchProposal, ResourceKind } from '@soulforge/shared';
export interface BuildGraphPatchOptions {
    resourceKindByUri?: ReadonlyMap<string, ResourceKind>;
}
/**
 * Project a PatchProposal into the graph patch IR.
 * This is the visual/impact model for AI review and future patch-graph UI.
 */
export declare function buildGraphPatchFromProposal(proposal: PatchProposal, options?: BuildGraphPatchOptions): GraphPatch;
export declare function attachGraphToProposal(proposal: PatchProposal, options?: BuildGraphPatchOptions): PatchProposal;
export declare function summarizeGraphPatch(graph: GraphPatch): string;
export declare function collectAffectedUris(changes: readonly PatchChange[]): string[];
