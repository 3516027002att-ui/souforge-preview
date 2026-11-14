import { randomUUID } from 'node:crypto';
const TERMINAL_PHASES = ['committed', 'rolled_back', 'failed'];
const PHASES = [
    'pending', 'staging', 'validating', 'backing_up', 'replacing',
    'after_commit_validation', 'marking_committed', 'committed', 'rolling_back',
    'rolled_back', 'recovery_required', 'failed'
];
/** Durable transaction, recovery, and audit access over one workspace.db connection. */
export class DurableWorkspaceRepository {
    database;
    workspaceId;
    constructor(database, workspaceId) {
        this.database = database;
        this.workspaceId = workspaceId;
    }
    createTransaction(record) {
        this.database.prepare(`
INSERT INTO transaction_journal (
  transaction_id, workspace_id, op_id, phase, state_json, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(record.transactionId, this.workspaceId, record.opId, record.phase, stringifyJson(record.state, 'transaction state'), record.createdAt, record.updatedAt);
    }
    transitionTransaction(options) {
        const expected = Array.isArray(options.expectedPhase)
            ? options.expectedPhase
            : [options.expectedPhase];
        if (expected.length === 0)
            throw new Error('Expected transaction phase must not be empty.');
        const placeholders = expected.map(() => '?').join(', ');
        const updatedAt = options.updatedAt ?? new Date().toISOString();
        const result = this.database.prepare(`
UPDATE transaction_journal
SET phase = ?, state_json = ?, updated_at = ?
WHERE workspace_id = ? AND transaction_id = ? AND phase IN (${placeholders})
`).run(options.nextPhase, stringifyJson(options.state, 'transaction state'), updatedAt, this.workspaceId, options.transactionId, ...expected);
        if (result.changes !== 1) {
            const current = this.getTransaction(options.transactionId);
            throw new Error(`Transaction phase conflict for ${options.transactionId}: expected ${expected.join('|')}, actual ${current?.phase ?? 'missing'}.`);
        }
        return this.getTransaction(options.transactionId);
    }
    getTransaction(transactionId) {
        const row = this.database.prepare(`
SELECT transaction_id AS transactionId, workspace_id AS workspaceId, op_id AS opId,
       phase, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt
FROM transaction_journal WHERE workspace_id = ? AND transaction_id = ?
`).get(this.workspaceId, transactionId);
        return row ? hydrateJournal(row) : undefined;
    }
    getTransactionForOperation(opId) {
        const row = this.database.prepare(`
SELECT transaction_id AS transactionId, workspace_id AS workspaceId, op_id AS opId,
       phase, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt
FROM transaction_journal WHERE workspace_id = ? AND op_id = ?
ORDER BY created_at DESC, transaction_id DESC LIMIT 1
`).get(this.workspaceId, opId);
        return row ? hydrateJournal(row) : undefined;
    }
    findTransactionsForRequest(sessionName, requestId) {
        const rows = this.database.prepare(`
SELECT transaction_id AS transactionId, workspace_id AS workspaceId, op_id AS opId,
       phase, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt
FROM transaction_journal
WHERE workspace_id = ? AND json_valid(state_json)
  AND json_extract(state_json, '$.request.sessionName') = ?
  AND json_extract(state_json, '$.request.id') = ?
ORDER BY created_at, transaction_id
`).all(this.workspaceId, sessionName, requestId);
        return rows.map(row => hydrateJournal(row));
    }
    listIncompleteTransactions() {
        const placeholders = TERMINAL_PHASES.map(() => '?').join(', ');
        return this.database.prepare(`
SELECT transaction_id AS transactionId, workspace_id AS workspaceId, op_id AS opId,
       phase, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt
FROM transaction_journal
WHERE workspace_id = ? AND phase NOT IN (${placeholders})
ORDER BY created_at, transaction_id
`).all(this.workspaceId, ...TERMINAL_PHASES).map((row) => hydrateJournal(row));
    }
    recordRecoveryPoint(record) {
        const recoveryId = record.recoveryId ?? randomUUID();
        this.database.prepare(`
INSERT INTO recovery_points (
  recovery_id, workspace_id, op_id, root_path, size_bytes, state, created_at, expires_at, metadata_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(recoveryId, this.workspaceId, record.opId ?? null, record.rootPath, record.sizeBytes, record.state, record.createdAt, record.expiresAt ?? null, stringifyJson(record.metadata, 'recovery metadata'));
        return { ...record, recoveryId, workspaceId: this.workspaceId };
    }
    listRecoveryPoints() {
        return this.database.prepare(`
SELECT recovery_id AS recoveryId, workspace_id AS workspaceId, op_id AS opId,
       root_path AS rootPath, size_bytes AS sizeBytes, state, created_at AS createdAt,
       expires_at AS expiresAt, metadata_json AS metadataJson
FROM recovery_points WHERE workspace_id = ? ORDER BY created_at DESC, recovery_id
`).all(this.workspaceId).map(hydrateRecovery);
    }
    planRecoveryCleanup(options = {}) {
        const now = options.now ?? new Date();
        const maxAgeDays = Math.max(0, options.maxAgeDays ?? 30);
        const maxBytes = Math.max(0, options.maxBytes ?? 10 * 1024 * 1024 * 1024);
        const active = this.listRecoveryPoints().filter((item) => item.state === 'active');
        const protectedRows = this.database.prepare(`
SELECT DISTINCT rp.recovery_id AS recoveryId
FROM recovery_points rp
LEFT JOIN patch_history ph ON ph.op_id = rp.op_id AND ph.workspace_id = rp.workspace_id
LEFT JOIN transaction_journal tj ON tj.op_id = rp.op_id AND tj.workspace_id = rp.workspace_id
WHERE rp.workspace_id = ? AND rp.state = 'active'
  AND (ph.status = 'recovery_required'
    OR tj.phase NOT IN ('committed', 'rolled_back', 'failed'))
`).all(this.workspaceId);
        const protectedIds = new Set(protectedRows.map((row) => row.recoveryId));
        const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
        const candidates = new Map();
        for (const point of active) {
            if (protectedIds.has(point.recoveryId))
                continue;
            const explicitlyExpired = point.expiresAt !== undefined && Date.parse(point.expiresAt) <= now.getTime();
            if (explicitlyExpired || Date.parse(point.createdAt) <= cutoff) {
                candidates.set(point.recoveryId, { ...point, reason: explicitlyExpired ? 'expired' : 'age' });
            }
        }
        const activeBytesBefore = active.reduce((sum, item) => sum + item.sizeBytes, 0);
        let projectedBytesAfter = activeBytesBefore
            - [...candidates.values()].reduce((sum, item) => sum + item.sizeBytes, 0);
        if (projectedBytesAfter > maxBytes) {
            const quotaPool = active
                .filter((item) => !protectedIds.has(item.recoveryId) && !candidates.has(item.recoveryId))
                .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
            for (const point of quotaPool) {
                if (projectedBytesAfter <= maxBytes)
                    break;
                candidates.set(point.recoveryId, { ...point, reason: 'quota' });
                projectedBytesAfter -= point.sizeBytes;
            }
        }
        return {
            candidates: [...candidates.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
            protectedRecoveryIds: [...protectedIds].sort(),
            activeBytesBefore,
            projectedBytesAfter,
            quotaSatisfied: projectedBytesAfter <= maxBytes
        };
    }
    markRecoveryPointExpired(recoveryId) {
        const result = this.database.prepare(`
UPDATE recovery_points SET state = 'expired'
WHERE workspace_id = ? AND recovery_id = ? AND state = 'active'
`).run(this.workspaceId, recoveryId);
        if (result.changes !== 1)
            throw new Error(`Active recovery point not found: ${recoveryId}.`);
    }
    appendAuditEvent(event) {
        const eventId = event.eventId ?? randomUUID();
        this.database.prepare(`
INSERT INTO audit_events (
  event_id, workspace_id, event_kind, op_id, transaction_id, payload_json, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(eventId, this.workspaceId, event.eventKind, event.opId ?? null, event.transactionId ?? null, stringifyJson(event.payload, 'audit payload'), event.createdAt);
        return { ...event, eventId, workspaceId: this.workspaceId };
    }
    listAuditEvents() {
        return this.database.prepare(`
SELECT event_id AS eventId, workspace_id AS workspaceId, event_kind AS eventKind,
       op_id AS opId, transaction_id AS transactionId, payload_json AS payloadJson,
       created_at AS createdAt
FROM audit_events WHERE workspace_id = ? ORDER BY created_at, event_id
`).all(this.workspaceId).map(hydrateAudit);
    }
    recordResourceEntryChange(record) {
        assertInverseOperation(record.inverse);
        this.database.prepare(`
INSERT INTO resource_entry_changes (
  id, op_id, workspace_id, resource_uri, entry_uri, change_kind,
  before_hash, after_hash, inverse_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(record.id, record.opId, this.workspaceId, record.resourceUri, record.entryUri, record.changeKind, record.beforeHash ?? null, record.afterHash ?? null, stringifyJson(record.inverse, 'resource entry inverse operation'));
    }
    listResourceEntryChanges(opId) {
        return this.database.prepare(`
SELECT id, workspace_id AS workspaceId, op_id AS opId, resource_uri AS resourceUri,
       entry_uri AS entryUri, change_kind AS changeKind, before_hash AS beforeHash,
       after_hash AS afterHash, inverse_json AS inverseJson
FROM resource_entry_changes WHERE workspace_id = ? AND op_id = ? ORDER BY id
`).all(this.workspaceId, opId).map((row) => {
            const inverse = parseJson(row.inverseJson, 'resource entry inverse operation');
            assertInverseOperation(inverse);
            return {
                id: row.id, workspaceId: row.workspaceId, opId: row.opId,
                resourceUri: row.resourceUri, entryUri: row.entryUri, changeKind: row.changeKind,
                ...(row.beforeHash ? { beforeHash: row.beforeHash } : {}),
                ...(row.afterHash ? { afterHash: row.afterHash } : {}), inverse
            };
        });
    }
}
function hydrateJournal(row) {
    return {
        transactionId: row.transactionId,
        workspaceId: row.workspaceId,
        opId: row.opId,
        phase: assertValue(row.phase, PHASES, 'transaction phase'),
        state: parseJson(row.stateJson, 'transaction state'),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}
function hydrateRecovery(row) {
    return {
        recoveryId: row.recoveryId, workspaceId: row.workspaceId,
        ...(row.opId ? { opId: row.opId } : {}), rootPath: row.rootPath,
        sizeBytes: row.sizeBytes,
        state: assertValue(row.state, ['active', 'restored', 'expired', 'failed'], 'recovery state'),
        createdAt: row.createdAt, ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
        metadata: parseJson(row.metadataJson, 'recovery metadata')
    };
}
function hydrateAudit(row) {
    return {
        eventId: row.eventId, workspaceId: row.workspaceId, eventKind: row.eventKind,
        ...(row.opId ? { opId: row.opId } : {}),
        ...(row.transactionId ? { transactionId: row.transactionId } : {}),
        payload: parseJson(row.payloadJson, 'audit payload'), createdAt: row.createdAt
    };
}
function stringifyJson(value, label) {
    const result = JSON.stringify(value);
    if (result === undefined)
        throw new Error(`${label} must be JSON serializable.`);
    return result;
}
function parseJson(value, label) {
    try {
        return JSON.parse(value);
    }
    catch (error) {
        throw new Error(`Corrupt ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function assertValue(value, allowed, label) {
    if (allowed.includes(value))
        return value;
    throw new Error(`Invalid ${label}: ${value}.`);
}
function assertInverseOperation(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Resource entry inverse operation must be an object.');
    }
    const operation = value;
    for (const field of ['id', 'kind', 'targetUri']) {
        if (typeof operation[field] !== 'string' || operation[field] === '') {
            throw new Error(`Resource entry inverse operation is missing ${field}.`);
        }
    }
    if (!Array.isArray(operation.preconditions) || !Array.isArray(operation.validatorRequirements)) {
        throw new Error('Resource entry inverse operation is missing validation metadata.');
    }
}
//# sourceMappingURL=durableWorkspaceRepository.js.map