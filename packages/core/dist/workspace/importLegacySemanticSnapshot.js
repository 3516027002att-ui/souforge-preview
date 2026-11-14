import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
export class LegacySemanticSnapshotImportError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
export async function importLegacySemanticSnapshot(options) {
    let bytes;
    try {
        bytes = await readFile(options.sourcePath);
    }
    catch (error) {
        if (isRecord(error) && error.code === 'ENOENT')
            return { status: 'source_missing', nodeCount: 0, edgeCount: 0 };
        throw new LegacySemanticSnapshotImportError('LEGACY_SEMANTIC_SNAPSHOT_READ_FAILED', '无法读取旧语义快照。', error);
    }
    const contentHash = sha256(bytes);
    const sourcePathHash = sha256(Buffer.from(normalizePath(options.sourcePath)));
    const sourceKind = 'semantic_snapshot_json_v1';
    const imported = options.database.prepare(`
SELECT 1 AS found FROM legacy_imports
WHERE source_kind = ? AND source_path_hash = ? AND content_hash = ?
`).get(sourceKind, sourcePathHash, contentHash);
    if (imported?.found === 1)
        return { status: 'already_imported', nodeCount: 0, edgeCount: 0, contentHash };
    const snapshot = parseAndValidate(bytes, options.workspaceId);
    await mkdir(options.backupDirectory, { recursive: true });
    const backupPath = join(options.backupDirectory, `${basename(options.sourcePath)}.${contentHash.slice(0, 16)}.readonly.json`);
    await copyFile(options.sourcePath, backupPath);
    await chmod(backupPath, 0o444).catch(() => undefined);
    const importedAt = new Date().toISOString();
    options.database.transaction(() => {
        // These graph tables were write-only. Keep the validated source archive and
        // import receipt; live semantic/knowledge projections rebuild from resources.
        options.database.prepare(`
INSERT INTO legacy_imports (
 source_kind, source_path_hash, content_hash, imported_at, record_count, backup_path
) VALUES (?, ?, ?, ?, ?, ?)
`).run(sourceKind, sourcePathHash, contentHash, importedAt, snapshot.graph.nodes.length + snapshot.graph.edges.length, backupPath);
    }).immediate();
    return {
        status: 'archived', nodeCount: snapshot.graph.nodes.length,
        edgeCount: snapshot.graph.edges.length, contentHash, backupPath
    };
}
function parseAndValidate(bytes, workspaceId) {
    let value;
    try {
        value = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        throw new LegacySemanticSnapshotImportError('LEGACY_SEMANTIC_SNAPSHOT_CORRUPT', '旧语义快照不是有效 JSON；未导入且未修改源文件。', error);
    }
    if (!isRecord(value) || value.workspaceId !== workspaceId || typeof value.createdAt !== 'string'
        || typeof value.version !== 'string' || !isRecord(value.graph)
        || !Array.isArray(value.graph.nodes) || !Array.isArray(value.graph.edges)) {
        throw new LegacySemanticSnapshotImportError('LEGACY_SEMANTIC_SNAPSHOT_SCHEMA_INVALID', '旧语义快照结构或工作区标识无效。');
    }
    const nodes = value.graph.nodes;
    const edges = value.graph.edges;
    const nodeIds = new Set();
    const uris = new Set();
    for (const [index, node] of nodes.entries()) {
        if (!isRecord(node) || !requiredStrings(node, ['id', 'kind', 'uri', 'label', 'createdAt', 'updatedAt'])
            || !Array.isArray(node.properties))
            schemaError(`nodes[${index}]`);
        if (nodeIds.has(node.id) || uris.has(node.uri))
            schemaError(`nodes[${index}] duplicate id or uri`);
        nodeIds.add(node.id);
        uris.add(node.uri);
    }
    const edgeIds = new Set();
    for (const [index, edge] of edges.entries()) {
        if (!isRecord(edge) || !requiredStrings(edge, ['id', 'kind', 'fromId', 'toId', 'createdAt', 'updatedAt'])
            || !Array.isArray(edge.properties))
            schemaError(`edges[${index}]`);
        if (edgeIds.has(edge.id) || !nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) {
            schemaError(`edges[${index}] duplicate id or missing endpoint`);
        }
        edgeIds.add(edge.id);
    }
    if (typeof value.nodeCount === 'number' && value.nodeCount !== nodes.length)
        schemaError('nodeCount mismatch');
    if (typeof value.edgeCount === 'number' && value.edgeCount !== edges.length)
        schemaError('edgeCount mismatch');
    return value;
}
function requiredStrings(value, fields) {
    return fields.every((field) => typeof value[field] === 'string' && value[field].length > 0);
}
function schemaError(reason) {
    throw new LegacySemanticSnapshotImportError('LEGACY_SEMANTIC_SNAPSHOT_SCHEMA_INVALID', `旧语义快照结构无效：${reason}。`);
}
function normalizePath(path) { const v = resolve(path); return process.platform === 'win32' ? v.toLowerCase() : v; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
//# sourceMappingURL=importLegacySemanticSnapshot.js.map