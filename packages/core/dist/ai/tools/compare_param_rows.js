import { asIdList, asOptionalString, asRecord, asString, fail, ok, requireEditSession } from '../toolRegistrySupport.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { readOriginSource } from '../readOrigin.js';
import { isAbsolute, relative } from 'node:path';
/** Workspace-relative POSIX spelling of the container that answered, never a host path. */
function containerRelativePath(context, absolutePath) {
    const root = context.session?.layers?.overlayRoot;
    if (root) {
        const rel = relative(root, absolutePath);
        if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))
            return rel.replaceAll('\\', '/');
    }
    return absolutePath.replaceAll('\\', '/');
}
const MAX_ROWS = 12;
const MAX_REPORTED = 40;
/** Cell window one native page may carry; 128 is the param layer's own maximum. */
const READ_PAGE_SIZE = 128;
/**
 * Page budget of one comparison (128 × 128 = 16384 cells). A table whose row set × field
 * count exceeds it is reported as incomplete instead of comparing a silently cut subset.
 */
const MAX_READ_PAGES = 128;
/**
 * compare_param_rows: which fields actually differ between a set of rows.
 *
 * "Which field makes these rows elite?" was unanswerable: the 352 fields of NpcParam can only be listed,
 * one page at a time, and comparing them by hand across eight rows is not something an agent can do
 * reliably. This returns the differences themselves — the fields whose values are not the same in every
 * selected row — so the discriminating field is in the answer instead of inferred from prose.
 *
 * The values are not re-derived here. `read_param_fields` and this tool both reach the same native
 * reader (`readParamFields`), and this tool now *is* that read: it asks for the whole trusted row
 * (`fieldIds: []`) and compares the cells the read delivered. It used to enumerate the field ids with a
 * second metadata walk and then fold every cell onto `values[rowId]`. Two consequences of that were
 * exactly the defect this replaces:
 *
 *   - a logical row with more than one physical row (23 such ids exist in the shipped Sekiro
 *     gameparam: ObjectParam 9035/106010/…, TalkParam 1101800/…, CutsceneParam 10000000/…) collapsed
 *     to whichever physical row the cell list happened to end on, while `read_param_fields` reports one
 *     cell per physical row — the same rowId + fieldId then had two different values depending on which
 *     tool you asked;
 *   - a value that JSON cannot spell distinctly (`0` vs `-0`, which `JSON.stringify` both render as
 *     `0`) was called constant, so the difference `read_param_fields` reports never appeared here.
 *
 * Both are fixed by keying on the physical identity the read delivered (entry + rowIndex + rowId) and by
 * comparing value signatures that keep `-0` distinct. When any requested row resolves to more than one
 * physical row the response switches to `rowId@rowIndex` keys and names the duplicated ids, so no
 * physical value is ever dropped or merged.
 */
export function createCompareParamRowsTool(deps = {}) {
    const readFields = deps.readParamFields ?? readParamFields;
    return {
        name: 'compare_param_rows',
        description: 'Report which fields differ across a small set of rows of one PARAM table. '
            + 'Use it when you know a set of rows that share a property (for example rows whose name ends in 精英) '
            + 'and need the field that distinguishes them from a row that lacks it. Returns only the fields whose '
            + 'values are not identical in every row, with each row value, plus counts of the constant ones. '
            + 'Reading a whole row is what this tool does; every value is the same native cell read_param_fields '
            + 'returns for that physical row. '
            + 'A logical PARAM row id can repeat within one child: when any requested row id resolves to more than '
            + 'one physical row the answer says so (duplicatePhysicalRows) and keys every value as '
            + 'rowId@rowIndex (valuesKeying=rowId@rowIndex) instead of merging two physical rows into one value; '
            + 'otherwise values are keyed by rowId alone and valuesKeying=rowId. '
            + '-0 and 0 are different values here, the same way the native read reports them.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string',
            rowIds: 'array',
            containerPath: 'string?',
            offset: 'number?',
            limit: 'number?',
            includeConstant: 'boolean?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const table = asString(value.table);
            const rowIds = asIdList(value.rowIds);
            // "needs at least 2" and "at most 12" were fixed sentences that never said how many rows
            // arrived, so a 0-row call and a 13-row call both read like the same rule. Name the count.
            if (!table || rowIds.length < 2) {
                const received = rowIds.length === 0
                    ? '没有收到任何 rowIds（0 行）'
                    : `只收到 ${rowIds.length} 行（${rowIds.join(', ')}）`;
                return fail('INVALID_INPUT', `${table ? '' : 'compare_param_rows 需要 table；'}本次${received}，比较至少需要 2 行。`);
            }
            if (rowIds.length > MAX_ROWS)
                return fail('INVALID_INPUT', `compare_param_rows 收到 ${rowIds.length} 行，一次最多比较 ${MAX_ROWS} 行；请分批（例如 ${MAX_ROWS} + ${rowIds.length - MAX_ROWS}）。`);
            const containerPath = asOptionalString(value.containerPath);
            const includeConstant = value.includeConstant === true;
            const offset = typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset >= 0 ? value.offset : 0;
            const limit = typeof value.limit === 'number' && Number.isSafeInteger(value.limit) ? Math.min(Math.max(1, value.limit), 128) : MAX_REPORTED;
            const cells = [];
            const definitions = new Map();
            const missingRows = [];
            let cursor;
            let sourceHash;
            let sourceRevision;
            let containerPathSeen;
            let pagesRead = 0;
            let cellsTruncated = false;
            for (; pagesRead < MAX_READ_PAGES; pagesRead++) {
                const read = await readFields({
                    edit: edit.session,
                    queries: [{ table, rowIds, fieldIds: [] }],
                    ...(containerPath ? { containerPath } : {}),
                    pageSize: READ_PAGE_SIZE,
                    ...(cursor ? { cursor } : {})
                });
                if (!read.ok)
                    return fail(read.error.code, read.error.message, read.error.details);
                containerPathSeen = read.containerPath;
                for (const field of read.fields) {
                    cells.push({
                        rowId: field.rowId,
                        ...(field.rowIndex === undefined ? {} : { rowIndex: field.rowIndex }),
                        ...(field.entryName ? { entryName: field.entryName } : {}),
                        ...(field.entryIndex === undefined ? {} : { entryIndex: field.entryIndex }),
                        fieldId: field.fieldId,
                        ...(field.displayName ? { displayName: field.displayName } : {}),
                        ...(field.dataHash ? { dataHash: field.dataHash } : {}),
                        value: field.value
                    });
                }
                for (const definition of read.fieldDefinitions ?? []) {
                    if (!definitions.has(definition.fieldId)) {
                        definitions.set(definition.fieldId, {
                            ...(definition.name ? { name: definition.name } : {}),
                            type: definition.type,
                            ...(definition.description ? { description: definition.description } : {})
                        });
                    }
                }
                for (const missing of read.missingRows) {
                    if (!missingRows.some((item) => item.rowId === missing.rowId))
                        missingRows.push(missing);
                }
                // Every page of one comparison must be the same bytes. Stitching two pages across a
                // write would publish values that never coexisted, and this is the exact place where
                // the "same field, two values" contradiction would come from.
                const pageHash = read.evidence?.sourceHash;
                if (pageHash !== undefined) {
                    if (sourceHash !== undefined && sourceHash !== pageHash) {
                        return fail('PARAM_READ_CHANGED_DURING_READ', `${table} 的分页读取跨了两个不同的原生内容（${sourceHash.slice(0, 12)} → ${pageHash.slice(0, 12)}）：比较结果不可信，请重读。`, { table, rowIds, previousSourceHash: sourceHash, currentSourceHash: pageHash });
                    }
                    sourceHash = pageHash;
                    sourceRevision ??= read.evidence?.sourceRevision;
                }
                const next = read.pagination?.nextCursor ?? null;
                if (!next)
                    break;
                cursor = next;
                if (pagesRead === MAX_READ_PAGES - 1)
                    cellsTruncated = true;
            }
            if (cells.length === 0) {
                return fail('PARAM_ROW_NOT_FOUND', `${table} 的行 ${rowIds.join(', ')} 没有读到任何字段：行不存在，或该表没有可解码的字段。`, { table, rowIds, missingRows });
            }
            // Physical identity is what the read delivered: one cell per (entry, rowIndex, rowId,
            // fieldId). Bucketing by rowId alone is what used to merge two physical rows.
            const physicalKey = (cell) => `${cell.rowId}@${cell.rowIndex ?? '?'}`;
            const rowIndexesById = new Map();
            for (const cell of cells) {
                const keys = rowIndexesById.get(cell.rowId) ?? new Set();
                keys.add(physicalKey(cell));
                rowIndexesById.set(cell.rowId, keys);
            }
            const duplicatePhysicalRows = [...rowIndexesById.entries()]
                .filter(([, keys]) => keys.size > 1)
                .map(([rowId]) => rowId)
                .sort((left, right) => left - right);
            const duplicateMode = duplicatePhysicalRows.length > 0;
            const requestedMissing = rowIds.filter((rowId) => !rowIndexesById.has(rowId));
            // Values are compared by a signature that keeps the distinctions the native read makes.
            // `JSON.stringify(-0)` is "0", so a 0/-0 pair used to look constant and never showed up.
            const signatureOf = (item) => {
                if (typeof item === 'number') {
                    if (Number.isNaN(item))
                        return 'nan';
                    if (Object.is(item, -0))
                        return '-0';
                    return String(item);
                }
                if (typeof item === 'undefined')
                    return 'undefined';
                return JSON.stringify(item);
            };
            const byField = new Map();
            for (const cell of cells) {
                const perPhysical = byField.get(cell.fieldId) ?? new Map();
                perPhysical.set(physicalKey(cell), cell.value);
                byField.set(cell.fieldId, perPhysical);
            }
            const rows = [];
            let constant = 0;
            let varying = 0;
            for (const [fieldId, perPhysical] of byField) {
                const distinct = new Set([...perPhysical.values()].map(signatureOf));
                if (distinct.size <= 1) {
                    constant++;
                    if (!includeConstant)
                        continue;
                }
                else {
                    varying++;
                }
                const values = {};
                // Request order first, then each physical row in the order the read delivered it; a
                // key names exactly one physical row in duplicate mode and exactly one row otherwise.
                for (const rowId of rowIds) {
                    const keys = rowIndexesById.get(rowId);
                    if (!keys)
                        continue;
                    if (!duplicateMode) {
                        // Exactly one physical row carries this id: the key set has one member,
                        // whatever its rowIndex spelling is.
                        const [only] = keys;
                        values[String(rowId)] = only === undefined ? null : perPhysical.get(only) ?? null;
                        continue;
                    }
                    for (const key of keys) {
                        if (!perPhysical.has(key))
                            continue;
                        values[key] = perPhysical.get(key) ?? null;
                    }
                }
                const definition = definitions.get(fieldId);
                rows.push({
                    fieldId,
                    ...(definition?.name ? { name: definition.name } : {}),
                    ...(definition?.type ? { type: definition.type } : {}),
                    ...(definition?.description ? { description: definition.description } : {}),
                    values
                });
            }
            const complete = !cellsTruncated && requestedMissing.length === 0;
            return ok({
                table,
                rowIds,
                comparedFields: byField.size,
                comparedCells: cells.length,
                constantFields: constant,
                // Counted from the cells, not from the page slice: `rows.length` reported constant
                // fields as varying whenever includeConstant=true.
                varyingFields: varying,
                valuesKeying: duplicateMode ? 'rowId@rowIndex' : 'rowId',
                ...(duplicateMode ? {
                    duplicatePhysicalRows,
                    duplicatePhysicalRowsNote: '这些行 id 在同一张表里有不止一条物理行；每条物理行的值分开给出（键为 rowId@rowIndex），不合并、不取其中一条。'
                } : {}),
                ...(requestedMissing.length > 0 ? { missingRows: requestedMissing.map((rowId) => ({ table, rowId })) } : {}),
                ...(cellsTruncated ? { cellsTruncated: true } : {}),
                fields: rows.slice(offset, offset + limit),
                complete: complete && offset + limit >= rows.length,
                nextOffset: offset + limit < rows.length ? offset + limit : null,
                ...(offset + limit < rows.length ? { fieldsTruncated: true } : {}),
                ...(containerPathSeen ? {
                    containerPath: containerRelativePath(context, containerPathSeen),
                    // Same provenance block read_param_fields publishes, so a caller can see which
                    // layer answered instead of assuming both tools read the same bytes.
                    source: readOriginSource('workspace', containerRelativePath(context, containerPathSeen))
                } : {}),
                ...(sourceHash ? { sourceHash } : {}),
                ...(sourceRevision !== undefined ? {
                    sourceRevision,
                    sourceRevisionKind: 'content-hash',
                    contentRevision: sourceRevision
                } : {}),
                ...(requestedMissing.length > 0 || cellsTruncated
                    ? { execution: { status: 'partial' } }
                    : {}),
                note: '这里只列出值不完全相同的字段。某字段在部分行相同、部分行不同，正是「这组行靠什么与其它行区分」的候选；'
                    + '想连相同的字段一起看，传 includeConstant=true。每个值都是 read_param_fields 对同一条物理行给出的原生格值。'
            });
        }
    };
}
//# sourceMappingURL=compare_param_rows.js.map