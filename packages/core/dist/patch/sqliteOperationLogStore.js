import { openWorkspaceDatabase } from '../storage/sqliteDatabase.js';
import { toHistoryEntry } from './operationLog.js';
import { DurableWorkspaceRepository } from '../storage/durableWorkspaceRepository.js';
export class SqliteOperationLogStore {
    database;
    workspaceId;
    ownsDatabase;
    constructor(database, workspaceId, ownsDatabase = false) {
        this.database = database;
        this.workspaceId = workspaceId;
        this.ownsDatabase = ownsDatabase;
    }
    async record(entry) {
        this.assertWorkspace(entry.workspaceId);
        this.database.transaction(() => this.writeRecord(entry)).immediate();
    }
    async get(opId) {
        const row = this.database.prepare(`
SELECT
  op_id AS opId,
  workspace_id AS workspaceId,
  title,
  author,
  mode,
  status,
  created_at AS createdAt,
  committed_at AS committedAt,
  rolled_back_at AS rolledBackAt,
  backup_root AS backupRoot,
  graph_json AS graphJson,
  diagnostics_json AS diagnosticsJson,
  transaction_id AS transactionId,
  recovery_path AS recoveryPath,
  recovery_reason AS recoveryReason,
  inverse_of_op_id AS inverseOfOpId,
  rollback_scope AS rollbackScope,
  rollback_target_uri AS rollbackTargetUri
FROM patch_history
WHERE workspace_id = ? AND op_id = ?
`).get(this.workspaceId, opId);
        return row ? this.hydrate(row) : undefined;
    }
    async getTransactionForOperation(opId) {
        return this.durableRepository().getTransactionForOperation(opId);
    }
    async findTransactionsForRequest(sessionName, requestId) {
        return this.durableRepository().findTransactionsForRequest(sessionName, requestId);
    }
    async list(workspaceId = this.workspaceId) {
        this.assertWorkspace(workspaceId);
        const rows = this.database.prepare(`
SELECT
  op_id AS opId,
  workspace_id AS workspaceId,
  title,
  author,
  mode,
  status,
  created_at AS createdAt,
  committed_at AS committedAt,
  rolled_back_at AS rolledBackAt,
  backup_root AS backupRoot,
  graph_json AS graphJson,
  diagnostics_json AS diagnosticsJson,
  transaction_id AS transactionId,
  recovery_path AS recoveryPath,
  recovery_reason AS recoveryReason,
  inverse_of_op_id AS inverseOfOpId,
  rollback_scope AS rollbackScope,
  rollback_target_uri AS rollbackTargetUri
FROM patch_history
WHERE workspace_id = ?
ORDER BY created_at DESC, op_id DESC
`).all(workspaceId);
        return rows.map((row) => this.hydrate(row));
    }
    async updateStatus(opId, status, patch = {}) {
        const existing = await this.get(opId);
        if (!existing)
            return undefined;
        const next = {
            ...existing,
            ...patch,
            opId: existing.opId,
            workspaceId: existing.workspaceId,
            status,
            diagnostics: patch.diagnostics ?? existing.diagnostics,
            files: patch.files ?? existing.files
        };
        await this.record(next);
        return this.get(opId);
    }
    async history(workspaceId = this.workspaceId) {
        return (await this.list(workspaceId)).map(toHistoryEntry);
    }
    async recordResourceEntryChange(record) {
        this.durableRepository().recordResourceEntryChange(record);
    }
    async listResourceEntryChanges(opId) {
        return this.durableRepository().listResourceEntryChanges(opId);
    }
    async finalizeCommit(bundle) {
        this.assertWorkspace(bundle.operation.workspaceId);
        const repository = this.durableRepository();
        this.database.transaction(() => {
            this.writeRecord(bundle.operation);
            for (const change of bundle.resourceEntryChanges)
                repository.recordResourceEntryChange(change);
            repository.recordRecoveryPoint(bundle.recoveryPoint);
            repository.appendAuditEvent(bundle.auditEvent);
            repository.transitionTransaction({
                transactionId: bundle.transactionId,
                expectedPhase: bundle.expectedPhase,
                nextPhase: 'committed',
                state: bundle.finalState
            });
        }).immediate();
    }
    /**
     * Durable journal capabilities backed by the same workspace.db connection.
     *
     * Implementing these directly on the core store makes the full journal phase
     * machine (pending -> staging -> validating -> backing_up -> replacing ->
     * marking_committed -> committed / rolled_back / failed) runnable on the core
     * path with a plain `SqliteOperationLogStore`, without requiring the desktop
     * database utility client (W-A-RECOVERY-INTEGRATION-04 core wiring).
     */
    createTransaction(record) {
        this.durableRepository().createTransaction(record);
        return Promise.resolve(null);
    }
    transitionTransaction(options) {
        return Promise.resolve(this.durableRepository().transitionTransaction(options));
    }
    recordRecoveryPoint(record) {
        return Promise.resolve(this.durableRepository().recordRecoveryPoint(record));
    }
    appendAuditEvent(event) {
        return Promise.resolve(this.durableRepository().appendAuditEvent(event));
    }
    hasLegacyImport(sourceKind, sourcePathHash, contentHash) {
        const row = this.database.prepare(`
SELECT 1 AS found
FROM legacy_imports
WHERE source_kind = ? AND source_path_hash = ? AND content_hash = ?
`).get(sourceKind, sourcePathHash, contentHash);
        return row?.found === 1;
    }
    importLegacyRecords(records, ledger) {
        for (const record of records)
            this.assertWorkspace(record.workspaceId);
        const insertLedger = this.database.prepare(`
INSERT INTO legacy_imports (
  source_kind,
  source_path_hash,
  content_hash,
  imported_at,
  record_count,
  backup_path
) VALUES (
  @sourceKind,
  @sourcePathHash,
  @contentHash,
  @importedAt,
  @recordCount,
  @backupPath
)
`);
        this.database.transaction(() => {
            for (const record of records)
                this.writeRecord(record);
            insertLedger.run(ledger);
        }).immediate();
    }
    close() {
        if (this.ownsDatabase && this.database.open)
            this.database.close();
    }
    durableRepository() {
        return new DurableWorkspaceRepository(this.database, this.workspaceId);
    }
    writeRecord(entry) {
        this.database.prepare(`
INSERT INTO patch_history (
  op_id,
  workspace_id,
  title,
  author,
  mode,
  status,
  created_at,
  committed_at,
  rolled_back_at,
  backup_root,
  file_count,
  graph_json,
  diagnostics_json,
  transaction_id,
  recovery_path,
  recovery_reason,
  inverse_of_op_id,
  rollback_scope,
  rollback_target_uri
) VALUES (
  @opId,
  @workspaceId,
  @title,
  @author,
  @mode,
  @status,
  @createdAt,
  @committedAt,
  @rolledBackAt,
  @backupRoot,
  @fileCount,
  @graphJson,
  @diagnosticsJson,
  @transactionId,
  @recoveryPath,
  @recoveryReason,
  @inverseOfOpId,
  @rollbackScope,
  @rollbackTargetUri
)
ON CONFLICT(op_id) DO UPDATE SET
  title = excluded.title,
  author = excluded.author,
  mode = excluded.mode,
  status = excluded.status,
  committed_at = excluded.committed_at,
  rolled_back_at = excluded.rolled_back_at,
  backup_root = excluded.backup_root,
  file_count = excluded.file_count,
  graph_json = excluded.graph_json,
  diagnostics_json = excluded.diagnostics_json,
  transaction_id = excluded.transaction_id,
  recovery_path = excluded.recovery_path,
  recovery_reason = excluded.recovery_reason,
  inverse_of_op_id = excluded.inverse_of_op_id,
  rollback_scope = excluded.rollback_scope,
  rollback_target_uri = excluded.rollback_target_uri
`).run({
            opId: entry.opId,
            workspaceId: entry.workspaceId,
            title: entry.title,
            author: entry.author,
            mode: entry.mode,
            status: entry.status,
            createdAt: entry.createdAt,
            committedAt: entry.committedAt ?? null,
            rolledBackAt: entry.rolledBackAt ?? null,
            backupRoot: entry.backupRoot ?? null,
            fileCount: entry.files.length,
            graphJson: entry.graph ? JSON.stringify(entry.graph) : null,
            diagnosticsJson: JSON.stringify(entry.diagnostics),
            transactionId: entry.transactionId ?? null,
            recoveryPath: entry.recoveryPath ?? null,
            recoveryReason: entry.recoveryReason ?? null,
            inverseOfOpId: entry.inverseOfOpId ?? null,
            rollbackScope: entry.rollbackScope ?? null,
            rollbackTargetUri: entry.rollbackTargetUri ?? null
        });
        this.database.prepare('DELETE FROM file_operations WHERE op_id = ?').run(entry.opId);
        const insertFile = this.database.prepare(`
INSERT INTO file_operations (
  id,
  op_id,
  workspace_id,
  target_uri,
  target_path,
  relative_path,
  before_hash,
  after_hash,
  backup_path,
  change_kind,
  resource_kind
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
        entry.files.forEach((file, index) => {
            insertFile.run(`${entry.opId}:${index}`, entry.opId, entry.workspaceId, file.targetUri, file.targetPath, file.relativePath ?? null, file.beforeHash, file.afterHash, file.backupPath, file.kind, file.resourceKind ?? null);
        });
    }
    hydrate(row) {
        const files = this.database.prepare(`
SELECT
  target_uri AS targetUri,
  target_path AS targetPath,
  relative_path AS relativePath,
  before_hash AS beforeHash,
  after_hash AS afterHash,
  backup_path AS backupPath,
  change_kind AS changeKind,
  resource_kind AS resourceKind
FROM file_operations
WHERE op_id = ?
ORDER BY id
`).all(row.opId).map(toFileRecord);
        return {
            opId: row.opId,
            workspaceId: row.workspaceId,
            title: row.title,
            author: assertEnum(row.author, ['user', 'ai'], 'author'),
            mode: assertEnum(row.mode, ['plan', 'normal', 'fullPermission'], 'mode'),
            status: assertEnum(row.status, [
                'planned',
                'pending',
                'staged',
                'validated',
                'committed',
                'rolled_back',
                'failed',
                'recovery_required'
            ], 'status'),
            createdAt: row.createdAt,
            ...(row.committedAt ? { committedAt: row.committedAt } : {}),
            ...(row.rolledBackAt ? { rolledBackAt: row.rolledBackAt } : {}),
            ...(row.backupRoot ? { backupRoot: row.backupRoot } : {}),
            files,
            diagnostics: parseJson(row.diagnosticsJson, 'diagnostics_json'),
            ...(row.graphJson ? { graph: parseJson(row.graphJson, 'graph_json') } : {}),
            ...(row.transactionId ? { transactionId: row.transactionId } : {}),
            ...(row.recoveryPath ? { recoveryPath: row.recoveryPath } : {}),
            ...(row.recoveryReason ? { recoveryReason: row.recoveryReason } : {}),
            ...(row.inverseOfOpId ? { inverseOfOpId: row.inverseOfOpId } : {}),
            ...(row.rollbackScope
                ? { rollbackScope: assertEnum(row.rollbackScope, ['operation', 'file', 'resource_entry'], 'rollback_scope') }
                : {}),
            ...(row.rollbackTargetUri ? { rollbackTargetUri: row.rollbackTargetUri } : {})
        };
    }
    assertWorkspace(workspaceId) {
        if (workspaceId !== this.workspaceId) {
            throw new Error(`Operation workspace mismatch: expected ${this.workspaceId}, got ${workspaceId}.`);
        }
    }
}
export function openSqliteOperationLogStore(options) {
    const database = openWorkspaceDatabase(options.databasePath, {
        ...(options.nativeBinding ? { nativeBinding: options.nativeBinding } : {})
    });
    const now = new Date().toISOString();
    database.prepare(`
INSERT INTO workspaces (workspace_id, root_path, game, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(workspace_id) DO UPDATE SET
  root_path = excluded.root_path,
  game = excluded.game,
  updated_at = excluded.updated_at
`).run(options.workspaceId, options.rootPath, options.game ?? 'unknown', now, now);
    return new SqliteOperationLogStore(database, options.workspaceId, true);
}
function toFileRecord(row) {
    return {
        targetUri: row.targetUri,
        targetPath: row.targetPath,
        ...(row.relativePath ? { relativePath: row.relativePath } : {}),
        beforeHash: row.beforeHash,
        afterHash: row.afterHash,
        backupPath: row.backupPath,
        kind: assertEnum(row.changeKind, ['text', 'binary', 'structured'], 'change_kind'),
        ...(row.resourceKind
            ? { resourceKind: row.resourceKind }
            : {})
    };
}
function parseJson(value, column) {
    try {
        return JSON.parse(value);
    }
    catch (error) {
        throw new Error(`Corrupt JSON in ${column}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function assertEnum(value, allowed, field) {
    if (allowed.includes(value))
        return value;
    throw new Error(`Invalid ${field} value in workspace.db: ${value}`);
}
//# sourceMappingURL=sqliteOperationLogStore.js.map