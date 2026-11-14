export function validateBatch(items) {
    if (items.length === 0 || items.length > 128)
        throw new Error('CLI_BATCH_SIZE_INVALID');
    const ids = new Set(items.map((item) => item.id));
    if (ids.size !== items.length)
        throw new Error('CLI_BATCH_ID_DUPLICATE');
    const seen = new Set();
    for (const item of items) {
        for (const dep of item.dependsOn ?? []) {
            if (!ids.has(dep))
                throw new Error(`CLI_BATCH_UNKNOWN_DEP:${dep}`);
            if (!seen.has(dep))
                throw new Error(`CLI_BATCH_DEP_ORDER:${item.id}->${dep}`);
        }
        seen.add(item.id);
    }
}
export async function executeBatch(items, call, options = {}) {
    validateBatch(items);
    const byId = new Map();
    const results = [];
    let failed = 0;
    let skipped = 0;
    for (const item of items) {
        const depFailed = (item.dependsOn ?? []).some((dep) => byId.get(dep)?.status !== 'success');
        if (depFailed) {
            skipped += 1;
            const result = { id: item.id, status: 'skipped_dependency' };
            byId.set(item.id, result);
            results.push(result);
            continue;
        }
        try {
            const result = await call(item);
            const ok = { id: item.id, status: 'success', result };
            byId.set(item.id, ok);
            results.push(ok);
        }
        catch (error) {
            failed += 1;
            const failure = { id: item.id, status: 'failed', error: error instanceof Error ? error.message : String(error) };
            byId.set(item.id, failure);
            results.push(failure);
            if (!options.continueOnError) {
                // 遇错停止：剩余依赖项全部记为 skipped_dependency。
                const remaining = items.slice(items.indexOf(item) + 1);
                for (const rest of remaining) {
                    skipped += 1;
                    const skippedResult = { id: rest.id, status: 'skipped_dependency' };
                    byId.set(rest.id, skippedResult);
                    results.push(skippedResult);
                }
                break;
            }
        }
    }
    return { results, succeeded: results.length - failed - skipped, failed, skipped };
}
//# sourceMappingURL=batchDispatcher.js.map