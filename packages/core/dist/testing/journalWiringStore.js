/**
 * Journal-wired operation-log store for recovery smokes.
 *
 * The plain SQLite operation-log store delegates the optional durable journal
 * methods (`createTransaction` / `transitionTransaction` /
 * `recordRecoveryPoint` / `appendAuditEvent`) to `DurableWorkspaceRepository`
 * and lets `finalizeCommit` run the atomic bundle. This mirrors what the
 * desktop main process wires through `operationLogUtilityClient`, so
 * `executePatchIrThroughTransaction` can drive the full
 * pending -> staging -> validating -> backing_up -> replacing ->
 * marking_committed -> committed phase machine over a real workspace.db.
 */
import { SqliteOperationLogStore } from '../patch/sqliteOperationLogStore.js';
import { DurableWorkspaceRepository } from '../storage/durableWorkspaceRepository.js';
import { openWorkspaceDatabase } from '../storage/sqliteDatabase.js';
export class JournalWiringStore {
    delegate;
    repository;
    constructor(delegate, repository) {
        this.delegate = delegate;
        this.repository = repository;
    }
    record(entry) {
        return this.delegate.record(entry);
    }
    get(opId) {
        return this.delegate.get(opId);
    }
    list(workspaceId) {
        return this.delegate.list(workspaceId);
    }
    updateStatus(opId, status, patch) {
        return this.delegate.updateStatus(opId, status, patch);
    }
    history(workspaceId) {
        return this.delegate.history(workspaceId);
    }
    recordResourceEntryChange(record) {
        return this.delegate.recordResourceEntryChange(record);
    }
    listResourceEntryChanges(opId) {
        return this.delegate.listResourceEntryChanges(opId);
    }
    createTransaction(record) {
        this.repository.createTransaction(record);
        return Promise.resolve(null);
    }
    transitionTransaction(options) {
        return Promise.resolve(this.repository.transitionTransaction(options));
    }
    recordRecoveryPoint(record) {
        return Promise.resolve(this.repository.recordRecoveryPoint(record));
    }
    appendAuditEvent(event) {
        return Promise.resolve(this.repository.appendAuditEvent(event));
    }
    finalizeCommit(bundle) {
        return this.delegate.finalizeCommit(bundle);
    }
    /** Close the underlying database (session boundary). */
    close() {
        this.delegate.close();
    }
}
/** Open a workspace database and ensure the workspace row exists. */
export function openSessionStore(databasePath, workspaceId, overlayRoot) {
    const database = openWorkspaceDatabase(databasePath);
    const now = new Date().toISOString();
    database.prepare(`
INSERT INTO workspaces (workspace_id, root_path, game, created_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(workspace_id) DO UPDATE SET
  root_path = excluded.root_path,
  game = excluded.game,
  updated_at = excluded.updated_at
`).run(workspaceId, overlayRoot, 'sekiro', now, now);
    const delegate = new SqliteOperationLogStore(database, workspaceId, true);
    const repository = new DurableWorkspaceRepository(database, workspaceId);
    return { database, store: new JournalWiringStore(delegate, repository), repository };
}
//# sourceMappingURL=journalWiringStore.js.map