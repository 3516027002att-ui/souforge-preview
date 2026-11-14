/**
 * In-memory temporal property graph scaffold.
 * SQLite-ready types live in @soulforge/shared; this is the runtime graph.
 */
import { randomUUID } from 'node:crypto';
export class MemoryResourceGraph {
    workspaceId;
    versionCounter = 0;
    version;
    nodes = new Map();
    edges = new Map();
    mutations = [];
    createdAt;
    updatedAt;
    constructor(workspaceId) {
        this.workspaceId = workspaceId;
        this.createdAt = nowIso();
        this.updatedAt = this.createdAt;
        this.version = this.nextVersion();
    }
    getVersion() {
        return this.version;
    }
    addNode(input) {
        if (this.nodes.has(input.id)) {
            throw new Error(`Node already exists: ${input.id}`);
        }
        const timestamp = nowIso();
        const node = {
            ...input,
            properties: input.properties ?? [],
            version: input.version ?? this.version,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        this.nodes.set(node.id, node);
        this.recordMutation('add_node', {
            actor: 'system',
            payload: { nodeId: node.id },
            affectedNodeIds: [node.id],
            affectedEdgeIds: []
        });
        return node;
    }
    updateNode(nodeId, patch) {
        const existing = this.requireNode(nodeId);
        const updated = {
            ...existing,
            ...patch,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: nowIso(),
            version: this.version
        };
        this.nodes.set(nodeId, updated);
        this.recordMutation('update_node', {
            actor: 'system',
            payload: { nodeId, patch },
            affectedNodeIds: [nodeId],
            affectedEdgeIds: []
        });
        return updated;
    }
    deleteNode(nodeId) {
        this.requireNode(nodeId);
        this.nodes.delete(nodeId);
        for (const [edgeId, edge] of [...this.edges.entries()]) {
            if (edge.fromId === nodeId || edge.toId === nodeId) {
                this.edges.delete(edgeId);
            }
        }
        this.recordMutation('delete_node', {
            actor: 'system',
            payload: { nodeId },
            affectedNodeIds: [nodeId],
            affectedEdgeIds: []
        });
    }
    addEdge(input) {
        if (this.edges.has(input.id)) {
            throw new Error(`Edge already exists: ${input.id}`);
        }
        this.requireNode(input.fromId);
        this.requireNode(input.toId);
        const timestamp = nowIso();
        const edge = {
            ...input,
            properties: input.properties ?? [],
            version: this.version,
            createdAt: timestamp,
            updatedAt: timestamp
        };
        this.edges.set(edge.id, edge);
        this.recordMutation('add_edge', {
            actor: 'system',
            payload: { edgeId: edge.id },
            affectedNodeIds: [edge.fromId, edge.toId],
            affectedEdgeIds: [edge.id]
        });
        return edge;
    }
    updateEdge(edgeId, patch) {
        const existing = this.requireEdge(edgeId);
        const updated = {
            ...existing,
            ...patch,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: nowIso(),
            version: this.version
        };
        this.edges.set(edgeId, updated);
        this.recordMutation('update_edge', {
            actor: 'system',
            payload: { edgeId, patch },
            affectedNodeIds: [updated.fromId, updated.toId],
            affectedEdgeIds: [edgeId]
        });
        return updated;
    }
    deleteEdge(edgeId) {
        const edge = this.requireEdge(edgeId);
        this.edges.delete(edgeId);
        this.recordMutation('delete_edge', {
            actor: 'system',
            payload: { edgeId },
            affectedNodeIds: [edge.fromId, edge.toId],
            affectedEdgeIds: [edgeId]
        });
    }
    attachProvenance(attachment) {
        if (attachment.targetKind === 'node') {
            const node = this.requireNode(attachment.targetId);
            this.updateNode(node.id, {
                provenance: mergeProvenance(node.provenance, attachment.chain)
            });
        }
        else if (attachment.targetKind === 'edge') {
            const edge = this.requireEdge(attachment.targetId);
            this.updateEdge(edge.id, {
                provenance: mergeProvenance(edge.provenance, attachment.chain)
            });
        }
        this.recordMutation('attach_provenance', {
            actor: 'system',
            payload: attachment,
            affectedNodeIds: attachment.targetKind === 'node' ? [attachment.targetId] : [],
            affectedEdgeIds: attachment.targetKind === 'edge' ? [attachment.targetId] : []
        });
    }
    attachDiagnostics(attachment) {
        if (attachment.targetKind === 'node') {
            const node = this.requireNode(attachment.targetId);
            this.updateNode(node.id, {
                diagnostics: [...(node.diagnostics ?? []), ...attachment.diagnostics]
            });
        }
        else if (attachment.targetKind === 'edge') {
            const edge = this.requireEdge(attachment.targetId);
            this.updateEdge(edge.id, {
                diagnostics: [...(edge.diagnostics ?? []), ...attachment.diagnostics]
            });
        }
        this.recordMutation('attach_diagnostics', {
            actor: 'system',
            payload: { targetId: attachment.targetId, count: attachment.diagnostics.length },
            affectedNodeIds: attachment.targetKind === 'node' ? [attachment.targetId] : [],
            affectedEdgeIds: attachment.targetKind === 'edge' ? [attachment.targetId] : []
        });
    }
    setNodeConfidence(nodeId, confidence) {
        return this.updateNode(nodeId, { confidence });
    }
    snapshot() {
        return {
            version: this.version,
            createdAt: nowIso(),
            nodeCount: this.nodes.size,
            edgeCount: this.edges.size,
            nodes: [...this.nodes.values()],
            edges: [...this.edges.values()],
            mutations: [...this.mutations]
        };
    }
    /**
     * Bump graph version after a logical batch of mutations (index/patch/rollback).
     */
    bumpVersion(actor = 'system') {
        this.version = this.nextVersion();
        this.updatedAt = nowIso();
        this.recordMutation('set_property', {
            actor,
            payload: { version: this.version },
            affectedNodeIds: [],
            affectedEdgeIds: [],
            bump: false
        });
        return this.version;
    }
    query(query = {}) {
        let nodes = [...this.nodes.values()];
        let edges = [...this.edges.values()];
        if (query.nodeIds?.length) {
            const set = new Set(query.nodeIds);
            nodes = nodes.filter((node) => set.has(node.id));
        }
        if (query.edgeIds?.length) {
            const set = new Set(query.edgeIds);
            edges = edges.filter((edge) => set.has(edge.id));
        }
        if (query.resourceKinds?.length) {
            const set = new Set(query.resourceKinds);
            nodes = nodes.filter((node) => node.resourceKind && set.has(node.resourceKind));
        }
        if (query.nodeKinds?.length) {
            const set = new Set(query.nodeKinds);
            nodes = nodes.filter((node) => set.has(node.kind));
        }
        if (query.edgeKinds?.length) {
            const set = new Set(query.edgeKinds);
            edges = edges.filter((edge) => set.has(edge.kind));
        }
        if (query.overlay) {
            nodes = nodes.filter((node) => node.overlay === query.overlay);
        }
        if (query.uriPrefix) {
            nodes = nodes.filter((node) => node.uri.startsWith(query.uriPrefix));
        }
        const limit = query.limit ?? 1000;
        nodes = nodes.slice(0, limit);
        edges = edges.slice(0, limit);
        if (!query.includeDiagnostics) {
            nodes = nodes.map((node) => omitDiagnostics(node));
            edges = edges.map((edge) => omitEdgeDiagnostics(edge));
        }
        if (!query.includeProvenance) {
            nodes = nodes.map((node) => omitProvenance(node));
            edges = edges.map((edge) => omitEdgeProvenance(edge));
        }
        return { nodes, edges };
    }
    toData() {
        return {
            workspaceId: this.workspaceId,
            version: this.version,
            nodes: [...this.nodes.values()],
            edges: [...this.edges.values()],
            mutations: [...this.mutations],
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }
    getEdge(edgeId) {
        return this.edges.get(edgeId);
    }
    requireNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node)
            throw new Error(`Node not found: ${nodeId}`);
        return node;
    }
    requireEdge(edgeId) {
        const edge = this.edges.get(edgeId);
        if (!edge)
            throw new Error(`Edge not found: ${edgeId}`);
        return edge;
    }
    nextVersion() {
        this.versionCounter += 1;
        return `g${this.versionCounter}`;
    }
    recordMutation(op, input) {
        if (input.bump !== false) {
            this.version = this.nextVersion();
        }
        this.updatedAt = nowIso();
        this.mutations.push({
            id: randomUUID(),
            op,
            version: this.version,
            timestamp: this.updatedAt,
            actor: input.actor,
            payload: input.payload,
            affectedNodeIds: input.affectedNodeIds,
            affectedEdgeIds: input.affectedEdgeIds
        });
    }
}
function nowIso() {
    return new Date().toISOString();
}
function mergeProvenance(existing, next) {
    if (!existing)
        return next;
    return {
        sources: [...existing.sources, ...next.sources],
        ...(existing.links || next.links
            ? { links: [...(existing.links ?? []), ...(next.links ?? [])] }
            : {})
    };
}
function omitDiagnostics(node) {
    const { diagnostics: _diagnostics, ...rest } = node;
    return rest;
}
function omitEdgeDiagnostics(edge) {
    const { diagnostics: _diagnostics, ...rest } = edge;
    return rest;
}
function omitProvenance(node) {
    const { provenance: _provenance, ...rest } = node;
    return rest;
}
function omitEdgeProvenance(edge) {
    const { provenance: _provenance, ...rest } = edge;
    return rest;
}
export function createEmptyResourceGraph(workspaceId) {
    return new MemoryResourceGraph(workspaceId);
}
//# sourceMappingURL=memoryResourceGraph.js.map