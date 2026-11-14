import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
/** Expose a container only as a workspace-relative URI, never a host path. */
export function paramContainerRecoveryUri(overlayRoot, containerPath) {
    const root = resolve(overlayRoot);
    const target = resolve(containerPath);
    const relativePath = relative(root, target);
    if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
        return undefined;
    }
    return `file://${relativePath.split(sep).join('/')}`;
}
/** A page is complete only when rows, requested fields, and all result pages were delivered. */
export function paramReadCoverage(input) {
    const complete = input.missingRows === 0 && input.missingFields === 0 && !input.hasMore;
    return { complete, status: complete ? 'complete' : 'partial' };
}
/**
 * What this delivery has covered **from the first cell of the read through the end of this page**.
 *
 * A continuation page used to be scored as if it were the whole read: page 2 of a 54-cell read
 * re-listed the rows page 1 had already delivered, so two pages that together deliver everything
 * reported `completeness=partial` on the second page. The position is already known without any
 * cross-process state — `offset` (or the cursor that encodes it) is an index into the same stable
 * cell list `pagination.totalCount` counts, and the cursor's scope hash pins table/rows/fields and
 * their order. So "cells 0..offset-1 were delivered by earlier pages" is a fact of the request, not
 * a guess, and the cumulative answer is reproducible in a new process.
 *
 * `deliveredCount` is this page's cell count, never a caller-supplied total: the cumulative boundary
 * is `offset + deliveredCount` and can never exceed the collection.
 */
export function paramReadDelivery(input) {
    const cellsDeliveredThrough = Math.max(0, Math.min(input.cells.length, input.offset + input.deliveredCount));
    const delivered = input.cells.slice(0, cellsDeliveredThrough);
    const countsByRowId = new Map();
    for (const cell of delivered)
        countsByRowId.set(cell.row.id, (countsByRowId.get(cell.row.id) ?? 0) + 1);
    const deliveredFieldIds = new Set(delivered.map((cell) => cell.fieldId));
    const deliveredRowCounts = [];
    const seenRowIds = new Set();
    for (const rowId of input.requestedRowIds) {
        if (seenRowIds.has(rowId))
            continue;
        seenRowIds.add(rowId);
        deliveredRowCounts.push({ rowId, delivered: countsByRowId.get(rowId) ?? 0 });
    }
    const undeliveredFieldIds = [];
    const seenFieldIds = new Set();
    for (const fieldId of input.requestedFieldIds) {
        if (seenFieldIds.has(fieldId) || deliveredFieldIds.has(fieldId))
            continue;
        seenFieldIds.add(fieldId);
        undeliveredFieldIds.push(fieldId);
    }
    return {
        scope: 'read',
        cellOffset: input.offset,
        cellsDeliveredThrough,
        totalCells: input.cells.length,
        deliveredRowCounts,
        undeliveredFieldIds
    };
}
/** Mixed documents bind hashes to their physical children, not an unordered hash set. */
export function paramReadSourceHash(cells) {
    const hashes = new Set(cells.map((cell) => cell.sourceHash));
    if (hashes.size === 1)
        return [...hashes][0];
    const versions = new Map();
    for (const cell of cells) {
        const key = JSON.stringify([cell.entryIndex, cell.table]);
        const previous = versions.get(key);
        if (previous !== undefined && previous !== cell.sourceHash) {
            throw Object.assign(new Error('PARAM 子文档在本次读取内出现不同版本。'), { code: 'PARAM_SOURCE_CHANGED_DURING_READ' });
        }
        versions.set(key, cell.sourceHash);
    }
    return createHash('sha256').update(JSON.stringify([...versions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest('hex');
}
/** Scope binds the complete request without copying its paths/field list into every cursor. */
export function paramReadWindow(input) {
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    // Two different positions in one request have no honest meaning: silently preferring one made a
    // caller believe it had read page N while it re-read page 1. Reject the ambiguity by name.
    if (input.cursor && input.offset !== undefined) {
        fail('INVALID_INPUT', 'PARAM 字段续页只能二选一：cursor 或 offset，不能同时给出。');
    }
    if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 128)
        fail('PARAM_CURSOR_INVALID', 'PARAM pageSize 无效。');
    const scopeHash = createHash('sha256').update(input.legacyScope);
    // The legacy scope sorted requested IDs although the delivered cells kept
    // request order. Bind actual physical cell order too, or reordered requests
    // could silently skip/duplicate cells at an otherwise valid offset.
    for (const cell of input.cells)
        scopeHash.update('\0').update(JSON.stringify(input.cellIdentity(cell)));
    const queryScope = `param-fields-v2:${scopeHash.digest('hex')}`;
    let offset = 0;
    if (input.cursor) {
        const payload = parseOpaqueCursor(input.cursor);
        if (payload.domain !== 'param' || (payload.scope !== queryScope && payload.scope !== input.legacyScope)) {
            fail('PARAM_CURSOR_SCOPE_MISMATCH', 'PARAM 字段 cursor 与当前工作区、表、行或字段集合不匹配，请重新读取。');
        }
        if (payload.sourceHash !== input.sourceHash)
            fail('STALE_READ_CURSOR', 'PARAM 来源已改变，请重新读取。');
        offset = payload.offset;
    }
    else if (input.offset !== undefined) {
        // A plain offset carries no scope/source binding, so it can only be checked against this read's
        // own collection. That is why an out-of-range value is a named refusal, not an empty page: an
        // empty page is indistinguishable from "the read is over".
        if (!Number.isSafeInteger(input.offset) || input.offset < 0) {
            fail('INVALID_INPUT', 'PARAM 字段 offset 必须是非负安全整数（0 表示第一页）；续页也可以改用 pagination.nextCursor。');
        }
        if (input.offset > input.cells.length) {
            fail('PARAM_OFFSET_OUT_OF_RANGE', `PARAM 字段 offset ${input.offset} 超出本次读取的字段格数 ${input.cells.length}；用 pagination.nextCursor 继续，或把 offset 调到 0..${input.cells.length}。`);
        }
        offset = input.offset;
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > input.cells.length)
        fail('PARAM_CURSOR_INVALID', 'PARAM 字段 cursor 的位置超出当前稳定结果集合。');
    const items = input.cells.slice(offset, offset + input.pageSize);
    const nextOffset = offset + items.length;
    const nextCursor = nextOffset < input.cells.length ? createOpaqueCursor({
        sessionId: 'param-fields-v2', offset: nextOffset, domain: 'param',
        sourceHash: input.sourceHash, scope: queryScope
    }) : null;
    const keys = new Set(items.map((item) => `${item.table}\0${item.fieldId}`));
    const fieldDefinitions = [];
    for (const key of keys) {
        const definition = input.definitions.get(key);
        if (definition !== undefined)
            fieldDefinitions.push(definition);
    }
    return { items, offset, nextCursor, queryScope, fieldDefinitions };
}
//# sourceMappingURL=paramReadWindow.js.map