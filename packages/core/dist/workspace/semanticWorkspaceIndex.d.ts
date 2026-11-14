/**
 * Semantic Workspace Index: VFS → ResourceGraph + snapshot persist/reload + reindex.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import { MemoryResourceGraph } from '../resource-graph/memoryResourceGraph.js';
import type { VfsTree } from '@soulforge/shared';
export interface SemanticSnapshot {
    workspaceId: string;
    createdAt: string;
    version: string;
    nodeCount: number;
    edgeCount: number;
    graph: ReturnType<MemoryResourceGraph['toData']>;
    vfsUriCount: number;
}
export interface SemanticWorkspaceIndex {
    workspaceId: string;
    workspaceRoot: string;
    graph: MemoryResourceGraph;
    vfs?: VfsTree;
    lastSnapshot?: SemanticSnapshot;
}
export declare function buildSemanticWorkspaceIndex(input: {
    workspaceId: string;
    workspaceRoot: string;
    game?: string;
}): Promise<SemanticWorkspaceIndex>;
export declare function ingestVfsIntoGraph(graph: MemoryResourceGraph, vfs: VfsTree): number;
/**
 * Ingest synthetic high/low confidence reference edges for tests/fixtures.
 */
export declare function ingestSyntheticReferenceEdge(graph: MemoryResourceGraph, input: {
    fromId: string;
    toId: string;
    confidence: 'high' | 'low';
    reason: string;
}): void;
export declare function createSemanticSnapshot(index: SemanticWorkspaceIndex): SemanticSnapshot;
export declare function persistSemanticSnapshot(snapshot: SemanticSnapshot, filePath: string): Promise<void>;
export declare function loadSemanticSnapshot(filePath: string): Promise<SemanticSnapshot>;
export declare function restoreGraphFromSnapshot(snapshot: SemanticSnapshot): MemoryResourceGraph;
export declare function reindexChangedResources(input: {
    index: SemanticWorkspaceIndex;
    changedPaths: string[];
}): Promise<{
    ok: boolean;
    updatedNodeIds: string[];
    diagnostics: StructuredDiagnostic[];
}>;
