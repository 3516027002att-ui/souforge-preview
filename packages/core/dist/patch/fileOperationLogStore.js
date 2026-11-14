import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { toHistoryEntry } from './operationLog.js';
/**
 * On-disk operation log implementing the same contract as MemoryOperationLogStore.
 * Persists to a single JSON file so commit / history / rollback survive process reopen.
 * Legacy compatibility store only. Production desktop opens this data through
 * the strict JSON -> workspace.db importer and never writes it again.
 */
export class FileOperationLogStore {
    storePath;
    byId = new Map();
    constructor(storePath) {
        this.storePath = storePath;
        this.reload();
    }
    /** Re-read the store file. Missing starts empty; corrupt input fails closed. */
    reload() {
        if (!existsSync(this.storePath)) {
            this.byId.clear();
            return;
        }
        try {
            const raw = readFileSync(this.storePath, 'utf8');
            const parsed = JSON.parse(raw);
            const entries = Array.isArray(parsed)
                ? parsed
                : parsed?.version === 1 && Array.isArray(parsed.entries)
                    ? parsed.entries
                    : null;
            if (!entries)
                throw new Error('Expected an array or a version=1 entries document.');
            const next = new Map();
            for (const entry of entries) {
                if (!entry || typeof entry.opId !== 'string' || !Array.isArray(entry.files)
                    || !Array.isArray(entry.diagnostics)) {
                    throw new Error('Operation log contains an invalid entry.');
                }
                next.set(entry.opId, cloneRecord(entry));
            }
            this.byId.clear();
            for (const [opId, entry] of next)
                this.byId.set(opId, entry);
        }
        catch (error) {
            this.byId.clear();
            throw new FileOperationLogCorruptError(this.storePath, error instanceof Error ? error.message : String(error));
        }
    }
    async record(entry) {
        this.byId.set(entry.opId, cloneRecord(entry));
        this.persist();
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
        this.persist();
        return cloneRecord(next);
    }
    async history(workspaceId) {
        return (await this.list(workspaceId)).map(toHistoryEntry);
    }
    persist() {
        const dir = dirname(this.storePath);
        mkdirSync(dir, { recursive: true });
        const document = {
            version: 1,
            entries: [...this.byId.values()].map(cloneRecord)
        };
        const payload = `${JSON.stringify(document, null, 2)}\n`;
        const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tempPath, payload, 'utf8');
        renameSync(tempPath, this.storePath);
    }
}
export class FileOperationLogCorruptError extends Error {
    storePath;
    code = 'LEGACY_OPERATION_LOG_CORRUPT';
    constructor(storePath, reason) {
        super(`旧操作日志已损坏，拒绝将其当作空历史继续写入：${reason}`);
        this.storePath = storePath;
    }
}
/** Open (or create) a file-backed operation log at the given path. */
export function openFileOperationLogStore(storePath) {
    return new FileOperationLogStore(storePath);
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
//# sourceMappingURL=fileOperationLogStore.js.map