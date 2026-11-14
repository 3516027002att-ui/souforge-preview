/**
 * In-memory operation log used until the desktop main process wires SQLite.
 * Semantics match the operation / file rollback model.
 */
export class MemoryOperationLogStore {
    byId = new Map();
    resourceEntryChanges = new Map();
    async record(entry) {
        this.byId.set(entry.opId, cloneRecord(entry));
    }
    async get(opId) {
        const entry = this.byId.get(opId);
        return entry ? cloneRecord(entry) : undefined;
    }
    async list(workspaceId) {
        const rows = [...this.byId.values()]
            .filter((entry) => !workspaceId || entry.workspaceId === workspaceId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return rows.map(cloneRecord);
    }
    async updateStatus(opId, status, patch = {}) {
        const existing = this.byId.get(opId);
        if (!existing)
            return undefined;
        const next = {
            ...existing,
            ...patch,
            status,
            diagnostics: patch.diagnostics ?? existing.diagnostics,
            files: patch.files ?? existing.files
        };
        this.byId.set(opId, next);
        return cloneRecord(next);
    }
    async recordResourceEntryChange(record) {
        const operation = this.byId.get(record.opId);
        if (!operation)
            throw new Error(`Operation not found for resource entry change: ${record.opId}.`);
        const existing = this.resourceEntryChanges.get(record.opId) ?? [];
        if (existing.some((item) => item.id === record.id))
            throw new Error(`Duplicate resource entry change: ${record.id}.`);
        existing.push(structuredClone({ ...record, workspaceId: operation.workspaceId }));
        this.resourceEntryChanges.set(record.opId, existing);
    }
    async listResourceEntryChanges(opId) {
        return structuredClone(this.resourceEntryChanges.get(opId) ?? []);
    }
    async history(workspaceId) {
        return (await this.list(workspaceId)).map(toHistoryEntry);
    }
}
const defaultStore = new MemoryOperationLogStore();
export function getDefaultOperationLogStore() {
    return defaultStore;
}
export function toHistoryEntry(entry) {
    return {
        opId: entry.opId,
        workspaceId: entry.workspaceId,
        title: entry.title,
        author: entry.author,
        mode: entry.mode,
        status: entry.status,
        createdAt: entry.createdAt,
        ...(entry.committedAt ? { committedAt: entry.committedAt } : {}),
        ...(entry.rolledBackAt ? { rolledBackAt: entry.rolledBackAt } : {}),
        fileCount: entry.files.length,
        changedPaths: entry.files.map((file) => file.targetPath),
        ...(entry.inverseOfOpId ? { inverseOfOpId: entry.inverseOfOpId } : {}),
        ...(entry.rollbackScope ? { rollbackScope: entry.rollbackScope } : {}),
        ...(entry.rollbackTargetUri ? { rollbackTargetUri: entry.rollbackTargetUri } : {}),
        ...(entry.graph
            ? {
                graphSummary: {
                    title: entry.graph.title,
                    fileCount: entry.graph.summary.fileCount,
                    resourceCount: entry.graph.summary.resourceCount,
                    edgeCount: entry.graph.summary.edgeCount
                }
            }
            : {})
    };
}
export function createCommittedOperationRecord(input) {
    const now = new Date().toISOString();
    return {
        opId: input.proposal.opId,
        workspaceId: input.proposal.workspaceId,
        title: input.proposal.title,
        author: input.proposal.author,
        mode: input.proposal.mode,
        status: 'committed',
        createdAt: input.proposal.createdAt,
        committedAt: now,
        backupRoot: input.backupRoot,
        files: input.files,
        diagnostics: input.diagnostics,
        ...(input.graph ? { graph: input.graph } : input.proposal.graph ? { graph: input.proposal.graph } : {})
    };
}
export function createPlannedOperationRecord(proposal, status = 'planned', diagnostics = []) {
    return {
        opId: proposal.opId,
        workspaceId: proposal.workspaceId,
        title: proposal.title,
        author: proposal.author,
        mode: proposal.mode,
        status,
        createdAt: proposal.createdAt,
        files: [],
        diagnostics,
        ...(proposal.graph ? { graph: proposal.graph } : {})
    };
}
function cloneRecord(entry) {
    return {
        ...entry,
        files: entry.files.map((file) => ({ ...file })),
        diagnostics: entry.diagnostics.map((diagnostic) => ({ ...diagnostic })),
        ...(entry.graph
            ? {
                graph: {
                    ...entry.graph,
                    nodes: entry.graph.nodes.map((node) => ({ ...node })),
                    edges: entry.graph.edges.map((edge) => ({ ...edge })),
                    summary: { ...entry.graph.summary }
                }
            }
            : {})
    };
}
//# sourceMappingURL=operationLog.js.map