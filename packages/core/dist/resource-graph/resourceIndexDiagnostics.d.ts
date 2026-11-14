/**
 * Aggregate resource graph + workspace index health into structured diagnostics.
 * Does not invent native authority — only reports graph completeness signals.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import type { MemoryResourceGraph } from './memoryResourceGraph.js';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
export interface ResourceIndexHealthReport {
    workspaceId: string;
    nodeCount: number;
    edgeCount: number;
    nodesWithoutKind: number;
    orphanNodes: number;
    candidateReferenceEdges: number;
    confirmedReferenceEdges: number;
    indexFileCount: number;
    indexReferenceCount: number;
    diagnostics: StructuredDiagnostic[];
}
/**
 * Build a health report for graph/index dashboards and AI context.
 */
export declare function buildResourceIndexHealthReport(input: {
    workspaceId: string;
    graph?: MemoryResourceGraph;
    index?: WorkspaceIndex;
}): ResourceIndexHealthReport;
