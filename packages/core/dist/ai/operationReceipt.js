const LOGICAL_DOMAINS = ['param', 'event', 'chr', 'map', 'msg', 'script', 'action', 'sfx', 'parts'];
/**
 * A receipt may carry the physical path the Patch Engine used (event writes recorded
 * file://Repository/SoulForge/tmp/.../event/x.emevd.dcx) while param writes recorded file://param/....
 * The renderer and the agent only ever need the workspace-relative logical address, and an absolute
 * path must not leave the host, so reduce anything before a known domain segment.
 */
function logicalTargetUri(uri) {
    if (!uri.startsWith('file://'))
        return uri;
    const rest = uri.slice('file://'.length);
    const segments = rest.split('/');
    const domainIndex = segments.findIndex((segment) => LOGICAL_DOMAINS.includes(segment.toLowerCase()));
    if (domainIndex <= 0)
        return uri;
    return `file://${segments.slice(domainIndex).join('/')}`;
}
export function projectOperationReceipt(record) {
    return {
        opId: record.opId,
        title: record.title,
        author: record.author,
        mode: record.mode,
        status: record.status,
        createdAt: record.createdAt,
        ...(record.committedAt === undefined ? {} : { committedAt: record.committedAt }),
        ...(record.rolledBackAt === undefined ? {} : { rolledBackAt: record.rolledBackAt }),
        ...(record.transactionId === undefined ? {} : { transactionId: record.transactionId }),
        ...(record.inverseOfOpId === undefined ? {} : { inverseOfOpId: record.inverseOfOpId }),
        ...(record.rollbackScope === undefined ? {} : { rollbackScope: record.rollbackScope }),
        ...(record.rollbackTargetUri === undefined ? {} : { rollbackTargetUri: logicalTargetUri(record.rollbackTargetUri) }),
        files: record.files.map((file) => ({
            targetUri: logicalTargetUri(file.targetUri),
            ...(file.relativePath === undefined ? {} : { relativePath: file.relativePath }),
            beforeHash: file.beforeHash,
            afterHash: file.afterHash,
            kind: file.kind,
            ...(file.resourceKind === undefined ? {} : { resourceKind: file.resourceKind })
        })),
        diagnostics: record.diagnostics
    };
}
export function projectPatchHistoryEntry(entry) {
    return {
        opId: entry.opId,
        title: entry.title,
        author: entry.author,
        mode: entry.mode,
        status: entry.status,
        createdAt: entry.createdAt,
        ...(entry.committedAt === undefined ? {} : { committedAt: entry.committedAt }),
        ...(entry.rolledBackAt === undefined ? {} : { rolledBackAt: entry.rolledBackAt }),
        fileCount: entry.fileCount,
        ...(entry.inverseOfOpId === undefined ? {} : { inverseOfOpId: entry.inverseOfOpId }),
        ...(entry.rollbackScope === undefined ? {} : { rollbackScope: entry.rollbackScope }),
        ...(entry.rollbackTargetUri === undefined ? {} : { rollbackTargetUri: entry.rollbackTargetUri }),
        ...(entry.graphSummary === undefined ? {} : { graphSummary: entry.graphSummary })
    };
}
/** Logical file URIs restored by a rollback, taken from the committed record. */
export function restoredFileUris(record, restoredFiles) {
    if (record && record.files.length === restoredFiles.length)
        return record.files.map((file) => logicalTargetUri(file.targetUri));
    if (record) {
        const byPath = new Map(record.files.map((file) => [file.targetPath, file.targetUri]));
        return restoredFiles.map((path) => logicalTargetUri(byPath.get(path) ?? basenameUri(path)));
    }
    return restoredFiles.map((path) => logicalTargetUri(basenameUri(path)));
}
function basenameUri(path) {
    const normalized = path.replaceAll('\\', '/');
    const name = normalized.split('/').pop() ?? normalized;
    return `file://${name}`;
}
/**
 * A session frame embeds the raw OperationLogRecord, which is the audit authority and keeps host
 * paths (targetPath, backupRoot, backupPath) plus the workspace file URL. A client must only ever
 * receive the logical receipt, so project every operation before the frame leaves the host.
 */
export function projectSessionTransactionFrame(transaction) {
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction))
        return transaction;
    const frame = transaction;
    const operations = Array.isArray(frame.operations) ? frame.operations : undefined;
    if (operations === undefined)
        return frame;
    return {
        ...frame,
        operations: operations.map((operation) => {
            if (!operation || typeof operation !== 'object' || Array.isArray(operation))
                return operation;
            const entry = operation;
            const record = entry.operation;
            if (!record || typeof record !== 'object' || Array.isArray(record))
                return entry;
            return { ...entry, operation: projectOperationReceipt(record) };
        })
    };
}
//# sourceMappingURL=operationReceipt.js.map