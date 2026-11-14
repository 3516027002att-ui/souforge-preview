import { AsyncLocalStorage } from 'node:async_hooks';
const activeRequest = new AsyncLocalStorage();
export function trackRequestOperations(observe, execute, identity) {
    return activeRequest.run({ observe, ...(identity ? { identity } : {}) }, execute);
}
export function noteOperationStarted(opId, store) {
    activeRequest.getStore()?.observe(opId, store);
}
/** Correlation is metadata in the existing journal, preserved through every phase. */
export function journalStateWithRequest(state) {
    const request = activeRequest.getStore()?.identity;
    return request ? { ...(state && typeof state === 'object' && !Array.isArray(state) ? state : { state }), request } : state;
}
/** Query authoritative state. Missing receipts and transport failure are unknown. */
export async function queryOperationOutcome(store, opId) {
    try {
        const operation = await store.get(opId);
        const journal = await store.getTransactionForOperation?.(opId);
        let state = 'unknown';
        if (operation?.status === 'recovery_required' || journal?.phase === 'recovery_required')
            state = 'recovery_required';
        else if (operation?.status === 'rolled_back' || journal?.phase === 'rolled_back')
            state = 'rolled_back';
        else if (operation?.status === 'committed' && (!journal || journal.phase === 'committed'))
            state = 'committed';
        return { opId, state, ...(operation ? { operation } : {}) };
    }
    catch {
        return { opId, state: 'unknown' };
    }
}
export function summarizeOperationOutcomes(operations, notStarted = false) {
    let state = notStarted ? 'not_committed' : 'unknown';
    if (operations.length) {
        if (operations.some(op => op.state === 'recovery_required'))
            state = 'recovery_required';
        else if (operations.some(op => op.state === 'unknown'))
            state = 'unknown';
        else if (operations.some(op => op.state === 'committed'))
            state = 'committed';
        else if (operations.every(op => op.state === 'rolled_back'))
            state = 'rolled_back';
        else if (operations.every(op => op.state === 'not_committed'))
            state = 'not_committed';
    }
    return {
        state,
        ...(operations.length === 1 ? { opId: operations[0].opId } : {}),
        ...(operations.length > 0 ? { opIds: operations.map((operation) => operation.opId) } : {}),
        operations
    };
}
/** Known executor receipt fields only; never model text or a tool-name heuristic. */
export function receiptOperationIds(value) {
    const ids = new Set();
    const visit = (node, depth) => {
        if (depth > 3 || !node || typeof node !== 'object' || Array.isArray(node))
            return;
        const record = node;
        if (typeof record.opId === 'string' && record.opId.trim())
            ids.add(record.opId);
        // A cross-table write reports one operation per table as `opIds`, not as a scalar.
        // Reading only `opId` treats that receipt as carrying no operation identity, so the
        // session frame falls back to an empty operations list and the caller loses every handle.
        if (Array.isArray(record.opIds)) {
            for (const opId of record.opIds) {
                if (typeof opId === 'string' && opId.trim())
                    ids.add(opId);
            }
        }
        if (typeof record.ok === 'boolean' && typeof record.content === 'string' && record.content.length <= 4 * 1024 * 1024) {
            try {
                visit(JSON.parse(record.content), depth + 1);
            }
            catch { /* Non-JSON diagnostics are not receipts. */ }
        }
        for (const key of ['data', 'operation', 'transaction', 'result'])
            visit(record[key], depth + 1);
    };
    visit(value, 0);
    return [...ids];
}
//# sourceMappingURL=operationOutcome.js.map