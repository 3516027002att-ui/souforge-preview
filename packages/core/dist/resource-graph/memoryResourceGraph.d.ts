/**
 * In-memory temporal property graph scaffold.
 * SQLite-ready types live in @soulforge/shared; this is the runtime graph.
 */
import type { ConfidenceAssessment, DiagnosticAttachmentRef, GraphMutation, GraphQuery, GraphSnapshot, GraphVersion, ProvenanceAttachmentRef, ResourceEdge, ResourceGraphData, ResourceNode, ResourceProperty } from '@soulforge/shared';
export declare class MemoryResourceGraph {
    readonly workspaceId: string;
    private versionCounter;
    private version;
    private readonly nodes;
    private readonly edges;
    private readonly mutations;
    private readonly createdAt;
    private updatedAt;
    constructor(workspaceId: string);
    getVersion(): GraphVersion;
    addNode(input: Omit<ResourceNode, 'createdAt' | 'updatedAt' | 'version' | 'properties'> & {
        properties?: ResourceProperty[];
        version?: GraphVersion;
    }): ResourceNode;
    updateNode(nodeId: string, patch: Partial<Omit<ResourceNode, 'id' | 'createdAt'>>): ResourceNode;
    deleteNode(nodeId: string): void;
    addEdge(input: Omit<ResourceEdge, 'createdAt' | 'updatedAt' | 'version' | 'properties'> & {
        properties?: ResourceProperty[];
    }): ResourceEdge;
    updateEdge(edgeId: string, patch: Partial<Omit<ResourceEdge, 'id' | 'createdAt'>>): ResourceEdge;
    deleteEdge(edgeId: string): void;
    attachProvenance(attachment: ProvenanceAttachmentRef): void;
    attachDiagnostics(attachment: DiagnosticAttachmentRef): void;
    setNodeConfidence(nodeId: string, confidence: ConfidenceAssessment): ResourceNode;
    snapshot(): GraphSnapshot;
    /**
     * Bump graph version after a logical batch of mutations (index/patch/rollback).
     */
    bumpVersion(actor?: GraphMutation['actor']): GraphVersion;
    query(query?: GraphQuery): {
        nodes: ResourceNode[];
        edges: ResourceEdge[];
    };
    toData(): ResourceGraphData;
    getNode(nodeId: string): ResourceNode | undefined;
    getEdge(edgeId: string): ResourceEdge | undefined;
    private requireNode;
    private requireEdge;
    private nextVersion;
    private recordMutation;
}
export declare function createEmptyResourceGraph(workspaceId: string): MemoryResourceGraph;
