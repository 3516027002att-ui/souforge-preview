/**
 * Agent / CLI PARAM field facade.
 *
 * Read and set named fields on rows inside gameparam.parambnd.dcx.
 * Encoding uses applyParamFieldMutation; unpack uses extract-bnd4-child;
 * write uses write-param mutations[] then write-bnd4 + applyNativeMutation.
 * Do not parse Smithbox XML here and do not scan BND by brute-force index.
 */
import { createHash } from 'node:crypto';
import { metadataPage } from '../ai/metadataPage.js';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { paramContainerRecoveryUri, paramReadCoverage, paramReadDelivery, paramReadSourceHash, paramReadWindow } from './paramReadWindow.js';
import { createBridgeDaemonScope, runBridge } from '../bridge/runBridge.js';
import { applyNativeMutation } from '../editing/editorMutationService.js';
import { commitParamMutationsViaBridge, readParamDocumentViaBridge } from '../editing/paramBridgeCommit.js';
import { stageBridgeOutput } from '../editing/bridgeStaging.js';
// PARAM hands out the same content-derived revision EMEVD does. Reusing that one
// implementation keeps "same bytes => same revision" true for both domains instead of
// growing a second, subtly different rule.
import { contentRevisionFromHash } from '../editing/emevdEdit.js';
import { applyParamFieldMutation } from './paramFieldMutation.js';
import { classifyFieldMatch, expandFieldQuery, fieldDescriptionSnippet, foldFieldText, hasCjk, nearestFieldCandidates, searchTaeFieldCatalog } from './fieldSemantics.js';
import { decodeRowFields } from './paramdefLayout.js';
import { matchParamMetadataPackage, resolveParamMetadataRowWidth } from './paramMetadata.js';
import { loadFirstPartyParamMetadata } from '../schema/sekiro/firstPartySchema.js';
let metadataCache = null;
/**
 * Remove one PARAM read handoff directory without ever accepting an arbitrary
 * path from a caller.  The remove operation is injectable only for the small
 * contract smoke: production always uses fs.rm, while the smoke can exercise
 * retry and failure diagnostics deterministically without changing ACLs on a
 * real workspace.
 */
export async function cleanupParamTempDirectory(input) {
    const root = resolve(input.stagingRoot);
    const candidate = resolve(input.tempDirectory);
    const relativeCandidate = relative(root, candidate);
    if (!relativeCandidate || relativeCandidate.includes('\\') || relativeCandidate.includes('/')
        || !relativeCandidate.startsWith('param-read-')) {
        return {
            severity: 'warning',
            code: 'PARAM_TEMP_CLEANUP_PATH_REJECTED',
            message: 'PARAM 临时目录清理路径未通过 stagingRoot 边界校验。',
            sourceUri: pathToFileURL(input.containerPath).href,
            details: { stagingRoot: root, candidate }
        };
    }
    const remove = input.remove ?? ((path) => rm(path, { recursive: true, force: true }));
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await remove(candidate);
            return undefined;
        }
        catch (error) {
            lastError = error;
            if (attempt === 0)
                await new Promise((resolveNext) => setImmediate(resolveNext));
        }
    }
    return {
        severity: 'warning',
        code: 'PARAM_TEMP_CLEANUP_FAILED',
        message: 'PARAM 临时目录清理失败，已保留本次读写结果。',
        sourceUri: pathToFileURL(input.containerPath).href,
        details: {
            path: candidate,
            errorName: lastError instanceof Error ? lastError.name : undefined,
            systemCode: lastError && typeof lastError === 'object' && 'code' in lastError
                && typeof lastError.code === 'string' ? lastError.code : undefined
        }
    };
}
export function groupParamEdits(edits) {
    const groups = new Map();
    for (const edit of edits) {
        const key = normalizeTableToken(edit.table);
        const list = groups.get(key) ?? [];
        list.push(edit);
        groups.set(key, list);
    }
    return groups;
}
export function applyEditsToRowBytes(input) {
    let data = input.rowDataBase64;
    const before = {};
    const after = {};
    for (const edit of input.edits) {
        const current = readFieldValue(data, input.definition, edit.fieldId);
        before[edit.fieldId] = current;
        const applied = applyParamFieldMutation({
            rowDataBase64: data,
            definition: input.definition,
            fieldId: edit.fieldId,
            value: edit.value
        });
        if (!applied.ok)
            return applied;
        data = applied.nextDataBase64;
        after[edit.fieldId] = readFieldValue(data, input.definition, edit.fieldId);
    }
    return { ok: true, nextDataBase64: data, before, after };
}
export async function resolveGameparamContainer(overlayRoot, explicit) {
    if (explicit) {
        let cleanPath = explicit.trim();
        if (cleanPath.startsWith('file:///')) {
            try {
                cleanPath = fileURLToPath(cleanPath);
            }
            catch {
                cleanPath = cleanPath.slice(8);
            }
        }
        else if (cleanPath.startsWith('file://')) {
            cleanPath = cleanPath.slice(7);
        }
        const resolved = isAbsolute(cleanPath)
            ? resolve(cleanPath)
            : resolve(overlayRoot, cleanPath);
        try {
            const info = await stat(resolved);
            if (!info.isFile()) {
                return { ok: false, error: { code: 'PARAM_CONTAINER_NOT_FILE', message: `不是文件：${resolved}` } };
            }
        }
        catch {
            return { ok: false, error: { code: 'PARAM_CONTAINER_MISSING', message: `找不到容器：${resolved}` } };
        }
        return { ok: true, path: resolved };
    }
    const preferred = [
        join(overlayRoot, 'param', 'gameparam', 'gameparam.parambnd.dcx'),
        join(overlayRoot, 'param', 'gameparam.parambnd.dcx')
    ];
    for (const candidate of preferred) {
        try {
            const info = await stat(candidate);
            if (info.isFile())
                return { ok: true, path: candidate };
        }
        catch {
            // try next
        }
    }
    const found = await findParamBnd(overlayRoot);
    if (found.length === 1)
        return { ok: true, path: found[0] };
    if (found.length === 0) {
        return {
            ok: false,
            error: {
                code: 'PARAM_CONTAINER_NOT_FOUND',
                message: '工作区里没有 gameparam.parambnd.dcx。请传 --container。'
            }
        };
    }
    return {
        ok: false,
        error: {
            code: 'PARAM_CONTAINER_AMBIGUOUS',
            message: `找到多份 parambnd，请指定 --container：${found.join(' | ')}`
        }
    };
}
/**
 * Content-derived `sourceRevision` for a PARAM read.
 *
 * The revision a caller keeps next to `sourceHash` is an equality token for the delivered
 * bytes, not a filesystem version. It used to be the container's mtime, so a write+rollback
 * that restored every byte still produced a different revision and invalidated the caller's
 * pre-write identity. Deriving it from the same content hash the read reports makes identical
 * bytes keep the identical revision; `contentRevisionFromHash` is the EMEVD implementation of
 * that rule (48 bits, safe integer), reused here so both domains cannot drift apart.
 */
export function paramContentRevision(sourceHash) {
    return contentRevisionFromHash(sourceHash);
}
export async function readParamFields(input) {
    // Fail closed before any native work: a contradictory window is an input error, not a read.
    if (input.cursor !== undefined && input.offset !== undefined) {
        return {
            ok: false,
            error: { code: 'INVALID_INPUT', message: 'PARAM 字段续页只能二选一：cursor 或 offset，不能同时给出。' },
            diagnostics: []
        };
    }
    const container = await resolveGameparamContainer(input.edit.session.layers.overlayRoot, input.containerPath);
    if (!container.ok)
        return { ok: false, error: container.error, diagnostics: [] };
    const diagnostics = [];
    const fields = [];
    const cells = [];
    const cellKeys = new Set();
    const matchedRowKeys = new Set();
    const fieldDefinitions = new Map();
    const missingRows = [];
    const missingFieldRows = new Map();
    const entries = await listParamEntries(input.edit, container.path);
    if (!entries.ok)
        return { ok: false, error: entries.error, diagnostics: entries.diagnostics };
    // Resolve aliases before loading anything, then merge requests that point
    // at the same physical child.  A single canonical entry read is enough for
    // multiple Agent/CLI queries and avoids repeated BND extraction and Bridge
    // parsing while preserving each query's own rowIndex/field projection.
    const groupedQueries = new Map();
    for (const query of input.queries) {
        // Group by the logical table alias, not by an already chosen physical
        // child: a native type such as ATK_PARAM_ST backs both AtkParam_Npc and
        // AtkParam_Pc, and only the requested row ids can tell them apart.
        const canonicalKey = paramTableAliasKey(query.table) || normalizeTableToken(query.table);
        const group = groupedQueries.get(canonicalKey) ?? {
            table: query.table,
            rowIds: new Set(),
            queries: []
        };
        for (const rowId of query.rowIds)
            group.rowIds.add(rowId);
        group.queries.push({
            ...query,
            rowIds: [...new Set(query.rowIds)],
            fieldIds: [...new Set(query.fieldIds)]
        });
        groupedQueries.set(canonicalKey, group);
    }
    const requestedRowCount = [...groupedQueries.values()].reduce((total, group) => total + group.rowIds.size, 0);
    let matchedRowCount = 0;
    for (const group of groupedQueries.values()) {
        // Field values are Bridge-decoded cells of exactly the fields this read delivers:
        // an empty fieldIds list means the whole trusted row, so no narrowing is sent.
        const allFields = group.queries.some((query) => query.fieldIds.length === 0);
        const valueProjection = allFields
            ? {}
            : { fieldIds: [...new Set(group.queries.flatMap((query) => query.fieldIds))] };
        const loaded = await loadTableRows(input.edit, container.path, entries.entries, group.table, [...group.rowIds], true, false, valueProjection);
        if (!loaded.ok)
            return { ok: false, error: loaded.error, diagnostics: [...diagnostics, ...loaded.diagnostics] };
        diagnostics.push(...loaded.diagnostics);
        for (const query of group.queries) {
            for (const rowId of query.rowIds) {
                const candidateSlots = loaded.slotsById.get(rowId);
                if (!candidateSlots || candidateSlots.length === 0) {
                    missingRows.push({ table: loaded.tableName, rowId });
                    continue;
                }
                const targetSlots = query.rowIndex !== undefined
                    ? candidateSlots.filter((s) => s.rowIndex === query.rowIndex)
                    : candidateSlots;
                if (targetSlots.length === 0) {
                    missingRows.push({ table: loaded.tableName, rowId });
                    continue;
                }
                for (const row of targetSlots) {
                    const matchedRowKey = `${loaded.entry.index}\u0000${loaded.tableName}\u0000${row.rowIndex}`;
                    if (!matchedRowKeys.has(matchedRowKey)) {
                        matchedRowKeys.add(matchedRowKey);
                        matchedRowCount += 1;
                    }
                    let foundAnyField = false;
                    // An empty fieldIds list is an explicit request for the complete
                    // trusted row projection. This lets the agent inspect a richly named
                    // PARAM row before it has to guess a field id, while the writer still
                    // requires explicit field ids for mutations.
                    const requestedFieldIds = query.fieldIds.length > 0
                        ? query.fieldIds
                        : loaded.definition.fields.map((field) => field.id);
                    for (const fieldId of requestedFieldIds) {
                        const field = loaded.definition.fields.find((item) => item.id === fieldId);
                        if (!field) {
                            const key = `${loaded.tableName}\u0000${fieldId}`;
                            let missing = missingFieldRows.get(key);
                            if (!missing) {
                                missing = { table: loaded.tableName, fieldId, rowIds: new Set() };
                                missingFieldRows.set(key, missing);
                            }
                            missing.rowIds.add(row.id);
                            diagnostics.push({
                                severity: 'warning',
                                code: 'PARAM_FIELD_NOT_FOUND',
                                // Use the resolved table name, not the caller's spelling: the same response reports
                                // missingFields[].table as the canonical name, and a machine consumer keying on it would
                                // otherwise see two spellings of one table.
                                message: `${loaded.tableName}.${fieldId} 不在授信定义里。`
                            });
                            continue;
                        }
                        foundAnyField = true;
                        const definitionKey = `${loaded.tableName}\u0000${fieldId}`;
                        if (!fieldDefinitions.has(definitionKey)) {
                            fieldDefinitions.set(definitionKey, {
                                fieldId,
                                name: field.name,
                                type: field.type,
                                ...(field.description ? { description: field.description } : {}),
                                ...(field.refs ? { refs: field.refs } : {})
                            });
                        }
                        const cellKey = `${matchedRowKey}\u0000${fieldId}`;
                        if (cellKeys.has(cellKey))
                            continue;
                        cellKeys.add(cellKey);
                        // Every cell of one physical child shares that child's content hash, so the
                        // revision pinned to the returned sourceHash is the identity of exactly these bytes.
                        const cellRevision = paramContentRevision(loaded.sourceHash);
                        cells.push({
                            table: loaded.tableName,
                            row,
                            entry: loaded.entry,
                            definition: loaded.definition,
                            fieldId,
                            sourceHash: loaded.sourceHash,
                            ...(cellRevision !== undefined ? { sourceRevision: cellRevision } : {})
                        });
                    }
                    if (!foundAnyField && requestedFieldIds.length > 0) {
                        return {
                            ok: false,
                            error: { code: 'PARAM_FIELD_NOT_FOUND', message: `${loaded.tableName} 请求的字段均不在授信定义里（${requestedFieldIds.join(', ')}）。` },
                            diagnostics
                        };
                    }
                }
            }
        }
    }
    if (fields.length === 0 && missingRows.length > 0) {
        return {
            ok: false,
            error: {
                code: 'PARAM_ROW_NOT_FOUND',
                message: `请求的 PARAM 行均不存在：${missingRows.map((row) => `${row.table}#${row.rowId}`).join(', ')}。先用 search_param_rows 按值搜索定位行 id，或 read_param_fields 读已知行确认。`
            },
            diagnostics
        };
    }
    let sourceHash;
    const legacyScope = `param-fields:${pathToFileURL(container.path).href}:${input.edit.session.meta.workspaceId}:${JSON.stringify([...groupedQueries.values()].map((group) => ({
        table: group.table,
        rowIds: [...group.rowIds].sort((a, b) => a - b),
        queries: group.queries.map((query) => ({ rowIndex: query.rowIndex, fieldIds: [...query.fieldIds].sort() }))
    })))}`;
    const pageSize = normalizeParamPageSize(input.pageSize);
    let window;
    try {
        sourceHash = paramReadSourceHash(cells.map((cell) => ({
            table: cell.table, entryIndex: cell.entry.index, sourceHash: cell.sourceHash
        })));
        window = paramReadWindow({ cells, definitions: fieldDefinitions, legacyScope, sourceHash, pageSize,
            cellIdentity: (cell) => [cell.entry.index, cell.table, cell.row.rowIndex, cell.row.id, cell.fieldId],
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.offset !== undefined ? { offset: input.offset } : {}) });
    }
    catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
            ? error.code : 'PARAM_CURSOR_INVALID';
        return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) }, diagnostics };
    }
    const { offset, nextCursor, queryScope } = window;
    for (const cell of window.items)
        fields.push(snapshotParamReadCell(cell));
    // The window only knows the cells it just handed over. Completeness is a property of the whole
    // read, so compute it here where the full stable cell list is in hand: a continuation page must
    // report the rows earlier pages already completed as delivered.
    const delivery = paramReadDelivery({
        cells,
        offset,
        deliveredCount: fields.length,
        requestedFieldIds: input.queries.flatMap((query) => query.fieldIds),
        requestedRowIds: input.queries.flatMap((query) => query.rowIds)
    });
    // Same rule as the per-cell value, applied to the hash this delivery actually reports.
    const evidenceRevision = paramContentRevision(sourceHash);
    const missingFields = [...missingFieldRows.values()].map((missing) => ({
        table: missing.table,
        fieldId: missing.fieldId,
        rowIds: [...missing.rowIds].sort((left, right) => left - right)
    }));
    const coverage = paramReadCoverage({
        missingRows: missingRows.length,
        missingFields: missingFields.length,
        hasMore: nextCursor !== null
    });
    const hasMissingFields = missingFields.length > 0;
    const recoveryContainerPath = paramContainerRecoveryUri(input.edit.session.layers.overlayRoot, container.path);
    return {
        ok: true,
        containerPath: container.path,
        fields,
        fieldDefinitions: window.fieldDefinitions,
        missingRows,
        ...(hasMissingFields ? {
            missingFields,
            nextActions: recoveryContainerPath ? missingFields.slice(0, 6).map((missing) => ({
                tool: 'search_param_fields',
                args: { table: missing.table, rowIds: missing.rowIds, query: missing.fieldId, containerPath: recoveryContainerPath },
                reason: '请求的 fieldId 不在当前授信定义中；先定位真实 fieldId，再用 read_param_fields 读取，当前结果不是完整字段读取。'
            })) : []
        } : {}),
        diagnostics,
        pagination: {
            offset,
            returnedCount: fields.length,
            totalCount: cells.length,
            hasMore: nextCursor !== null,
            nextCursor,
            pageSize,
            queryScope
        },
        execution: { status: missingRows.length > 0 || hasMissingFields ? 'partial' : 'completed', native: 'completed' },
        scan: {
            status: missingRows.length > 0 || hasMissingFields ? 'partial' : 'complete',
            requestedRows: requestedRowCount, matchedRows: matchedRowCount,
            missingRows: missingRows.length, ...(hasMissingFields ? { missingFields: missingFields.length } : {})
        },
        page: { status: coverage.status, source: 'native', offset, remaining: Math.max(0, cells.length - offset - fields.length) },
        delivery,
        evidence: {
            status: coverage.status,
            sourceHash,
            ...(evidenceRevision !== undefined
                ? { sourceRevision: evidenceRevision, sourceRevisionKind: 'content-hash', contentRevision: evidenceRevision }
                : {}),
            complete: coverage.complete
        }
    };
}
export async function readParamRowsPage(input) {
    const container = await resolveGameparamContainer(input.edit.session.layers.overlayRoot, input.containerPath);
    if (!container.ok)
        return { ok: false, error: container.error, diagnostics: [] };
    const entries = await listParamEntries(input.edit, container.path);
    if (!entries.ok)
        return { ok: false, error: entries.error, diagnostics: entries.diagnostics };
    const candidates = findTableEntries(entries.entries, input.table);
    if (candidates.length === 0) {
        return {
            ok: false,
            error: {
                code: 'PARAM_TABLE_NOT_FOUND',
                message: `容器内没有表 ${input.table}。`,
                details: { available: entries.entries.map((item) => basename(item.name.replace(/\\/g, '/'))) }
            },
            diagnostics: entries.diagnostics
        };
    }
    // A native type name can back several physical children. Enumerating a whole row set needs one
    // physical table, and without requested row ids there is nothing to disambiguate with: accept a
    // unique candidate, or the exact physical spelling, and otherwise fail closed.
    const exact = candidates.filter((entry) => isExactPhysicalTableName(entry, input.table));
    const chosen = candidates.length === 1 ? candidates[0] : exact.length === 1 ? exact[0] : undefined;
    if (chosen === undefined) {
        const candidateNames = candidates.map((entry) => basename(entry.name.replace(/\\/g, '/'))).join(' / ');
        return {
            ok: false,
            error: {
                code: 'PARAM_TABLE_AMBIGUOUS',
                message: `${input.table} 对应多个物理表（${candidateNames}），整表行集读取需要确切的物理表名；`
                    + '请改用物理名（例如 AtkParam_Npc / AtkParam_Pc）后重试。',
                details: { requestedTable: input.table, candidates: candidateNames }
            },
            diagnostics: entries.diagnostics
        };
    }
    // Whole ordered table, every row identity; the page is cut here, not by the Bridge projection.
    const loaded = await loadTableRowsFromEntry(input.edit, container.path, chosen, [], false, true);
    if (!loaded.ok)
        return { ok: false, error: loaded.error, diagnostics: loaded.diagnostics };
    try {
        const ordered = [...loaded.slots].sort((left, right) => left.rowIndex - right.rowIndex);
        const rowCount = ordered.length;
        const rowOffset = input.rowOffset ?? 0;
        if (!Number.isSafeInteger(rowOffset) || rowOffset < 0 || rowOffset > rowCount) {
            return {
                ok: false,
                error: {
                    code: 'PARAM_ROW_OFFSET_OUT_OF_RANGE',
                    message: `rowOffset ${String(input.rowOffset)} 超出整表行数 ${rowCount}。`,
                    details: { rowOffset: input.rowOffset, rowCount }
                },
                diagnostics: loaded.diagnostics
            };
        }
        const rowLimit = Number.isSafeInteger(input.rowLimit) && input.rowLimit >= 1 && input.rowLimit <= 512
            ? input.rowLimit
            : 256;
        const slice = ordered.slice(rowOffset, rowOffset + rowLimit);
        const rows = slice.map((slot) => ({
            rowIndex: slot.rowIndex,
            rowId: slot.id,
            ...(slot.name ? { rowName: slot.name } : {})
        }));
        const nextOffset = rowOffset + rows.length;
        const hasMore = nextOffset < rowCount;
        const sourceRevision = paramContentRevision(loaded.sourceHash);
        return {
            ok: true,
            containerPath: container.path,
            table: loaded.tableName,
            rowCount,
            rowOffset,
            rowLimit,
            rowReturned: rows.length,
            hasMore,
            ...(hasMore ? { nextOffset } : {}),
            rows,
            sourceHash: loaded.sourceHash,
            ...(sourceRevision === undefined ? {} : { sourceRevision }),
            diagnostics: loaded.diagnostics
        };
    }
    finally {
        await loaded.cleanup();
    }
}
function normalizeParamPageSize(value) {
    if (value === undefined)
        return 32;
    if (!Number.isSafeInteger(value) || value < 1 || value > 128)
        return 32;
    return value;
}
function snapshotParamReadCell(cell) {
    const field = cell.definition.fields.find((item) => item.id === cell.fieldId);
    // The value is the Bridge's decoded cell for exactly these row bytes. A field the
    // Bridge reported without a value (`unsupported` type) stays `null` here; the cell's
    // `status`/`rawHex` are the Bridge's evidence, and this projection has no slot for
    // them, so nothing is invented in their place.
    const decoded = cell.row.cells?.find((item) => item.fieldId === cell.fieldId);
    return {
        table: cell.table,
        rowId: cell.row.id,
        rowIndex: cell.row.rowIndex,
        dataHash: cell.row.dataHash,
        entryName: cell.entry.name,
        entryIndex: cell.entry.index,
        ...(cell.row.name ? { rowName: cell.row.name } : {}),
        fieldId: cell.fieldId,
        ...(field?.name && field.name !== cell.fieldId ? { displayName: field.name } : {}),
        ...(field?.description ? { description: field.description } : {}),
        ...(field?.refs ? { refs: field.refs } : {}),
        sourceHash: cell.sourceHash,
        ...(cell.sourceRevision !== undefined
            ? { sourceRevision: cell.sourceRevision, sourceRevisionKind: 'content-hash', contentRevision: cell.sourceRevision }
            : {}),
        value: decoded?.value ?? null
    };
}
/**
 * Search the trusted definition for fields relevant to an already resolved
 * native row. This is deliberately separate from read_param_fields: it lets
 * the Agent obtain real field IDs without sending an unbounded full-row read,
 * while the subsequent value read still requires an explicit non-empty list.
 */
export async function searchParamFieldDefinitions(input) {
    const query = input.query.trim();
    const listAllFields = query === '' || query === '*';
    if (input.rowIds.length === 0) {
        return {
            ok: false,
            error: { code: 'PARAM_FIELD_QUERY_REQUIRED', message: 'search_param_fields 需要已定位的 table 和 rowIds。' },
            diagnostics: []
        };
    }
    const container = await resolveGameparamContainer(input.edit.session.layers.overlayRoot, input.containerPath);
    if (!container.ok)
        return { ok: false, error: container.error, diagnostics: [] };
    const entries = await listParamEntries(input.edit, container.path);
    if (!entries.ok)
        return { ok: false, error: entries.error, diagnostics: entries.diagnostics };
    const loaded = await loadTableRows(input.edit, container.path, entries.entries, input.table, input.rowIds);
    if (!loaded.ok)
        return loaded;
    const expanded = expandFieldQuery(query);
    const queryTerms = expanded.matchTerms;
    // Alias expansion multiplies the term set ("血条" also brings hp/health/ninsatu/…), so the coverage
    // threshold must scale with what the caller actually typed, not with the expanded list.
    const userTermCount = expanded.userTermCount;
    const coverageOf = (field) => countParamFieldTermMatches(field, expanded.coverageTerms);
    // 说明文本单独算一份覆盖度：它能把「词只写在说明里」的字段召回，但不能决定名字命中的
    // 覆盖度门槛，否则多词查询会被散文里散落的短词刷屏。
    const proseCoverageOf = (field) => countParamFieldTermMatches(field, expanded.coverageTerms, { includeDescription: true });
    const matchOf = (field) => listAllFields ? undefined : classifyFieldMatch({
        fieldId: field.id,
        name: field.name,
        ...(field.description ? { description: field.description } : {})
    }, queryTerms, { preferCjkTerms: expanded.hasCjk });
    const ranked = listAllFields ? loaded.definition.fields.map((field) => ({ field, score: 1, strong: true, coverage: 1, proseCoverage: 1, match: undefined })) : loaded.definition.fields.map((field) => {
        const match = matchOf(field);
        // 中文名/中文说明命中要被排到前面：`判定距離` 这个名字比 id 里恰好含 dist 的字段
        // 更接近用户说的「距离」。旧排序只看 id 包含，中文命中会被 ASCII id 挤下去。
        const cjkBonus = match === undefined || !match.matchedTerms.some((term) => hasCjk(term)) ? 0
            : match.matchedField === 'name' ? 80
                : match.matchedField === 'description' ? 40 : 0;
        return {
            field,
            score: scoreParamFieldDefinition(field, queryTerms) + cjkBonus,
            strong: isStrongParamFieldMatch(field, queryTerms),
            coverage: coverageOf(field),
            proseCoverage: proseCoverageOf(field),
            match
        };
    })
        .filter((item) => item.score > 0)
        // 名字/ id 命中永远排在说明命中之前：说明命中是弱证据，同分时也不能靠 id 长度抢位。
        .sort((left, right) => Number(right.strong) - Number(left.strong)
        || right.score - left.score
        // Shorter ids first on a tie: `lotItemId01` is the concrete field, `lotItemBasePoint01` merely shares
        // the same words. Alphabetical order alone put the broader name first.
        || left.field.id.length - right.field.id.length
        || left.field.id.localeCompare(right.field.id));
    // A multi-term query is an AND-shaped request. "hit spEffect poison" matched 105 fields under OR
    // because each word appears somewhere, so require at least half of the caller's terms (all of them
    // when one field matches them all) and report which rule was used.
    const bestCoverage = ranked.reduce((max, item) => Math.max(max, item.coverage), 0);
    const requiredCoverage = bestCoverage >= expanded.coverageTerms.length && userTermCount > 1
        ? expanded.coverageTerms.length
        : Math.max(1, Math.ceil(userTermCount / 2));
    const covered = ranked.filter((item) => item.coverage >= requiredCoverage);
    const matchMode = requiredCoverage >= userTermCount && userTermCount > 1
        ? 'all-terms'
        : requiredCoverage > 1 ? 'majority-terms' : 'any-term';
    // 说明命中以前被整批丢掉（有 id/名字命中时），于是「ボス 只在 npcType 的说明里」这种
    // 字段永远不出现，agent 得出「NpcParam 没有 boss 字段」的错误结论。现在不再丢：
    // 名字命中在前，说明命中在后；多词查询里说明也要覆盖到同一档位数才留下，避免散文刷屏。
    const requiredProseCoverage = Math.max(1, Math.ceil(userTermCount / 2));
    const kept = listAllFields ? ranked
        : [...covered.filter((item) => item.strong),
            ...ranked.filter((item) => !item.strong && item.proseCoverage >= requiredProseCoverage)];
    const strongKept = kept.filter((item) => item.strong).length;
    const proseKept = kept.length - strongKept;
    const matchScope = proseKept === 0 ? 'field-id-or-name'
        : strongKept > 0 ? 'field-id-or-name+description' : 'description-only';
    const droppedWeakMatches = ranked.length - kept.length;
    const keptIds = new Set(kept.map((item) => item.field.id));
    const droppedFieldIds = ranked.filter((item) => !keptIds.has(item.field.id)).map((item) => item.field.id).slice(0, 8);
    const scored = kept.map(({ field, match }) => {
        const snippet = match?.matchedField === 'description'
            ? fieldDescriptionSnippet(field.description, match.matchedTerms)
            : undefined;
        return {
            fieldId: field.id,
            name: field.name,
            type: field.type,
            table: loaded.tableName,
            ...(field.description ? { description: field.description } : {}),
            ...(field.refs ? { refs: field.refs } : {}),
            ...(match === undefined ? {} : {
                matchedBy: match.matchedBy,
                matchedField: match.matchedField,
                matchedTerms: match.matchedTerms.slice(0, 6)
            }),
            ...(snippet === undefined ? {} : { descriptionSnippet: snippet })
        };
    });
    // 「判定距离」不是任何 PARAM 表的字段，它是 TAE 事件 760 的字段。以前这类查询只有
    // PARAM 一条路，答不出时 agent 只能凭记忆同时写 Reference Distance 与
    // Enable Range Maximum 兜底。现在把强相关的 TAE 字段一并回显（只回显收录标签或
    // 整名精确命中的，避免把词汇相关的字段混进来）；PARAM 侧的结果仍按原规则返回。
    const crossDomainFields = listAllFields ? [] : searchTaeFieldCatalog(query, { limit: 4 })
        .filter((candidate) => candidate.matchKind === 'curated-label' || candidate.matchKind === 'exact-name');
    // 零命中不等于「没有这个字段」：给出同表里最接近的字段名，让下一跳有起点。
    const nearestFields = !listAllFields && kept.length === 0
        ? nearestFieldCandidates(query, loaded.definition.fields.map((field) => ({
            fieldId: field.id,
            name: field.name,
            table: loaded.tableName
        })), 5)
        : [];
    // Field-definition provenance carries the same content-derived revision as the field
    // read it is meant to precede; the container mtime is not this document's identity.
    const sourceRevision = paramContentRevision(loaded.sourceHash);
    let page;
    try {
        page = metadataPage({ items: scored, domain: 'param', sourceHash: loaded.sourceHash,
            scope: { workspace: input.edit.session.layers.overlayRoot, container: container.path, table: loaded.tableName, rowIds: [...input.rowIds].sort((a, b) => a - b), query },
            ...(input.limit !== undefined ? { limit: input.limit } : {}), ...(input.cursor ? { cursor: input.cursor } : {}) });
    }
    catch (error) {
        return { ok: false, error: { code: error.code ?? 'PARAM_METADATA_PAGE_FAILED', message: error instanceof Error ? error.message : String(error), details: error.details }, diagnostics: loaded.diagnostics };
    }
    const { items: fields, ...pagination } = page;
    return {
        ok: true,
        containerPath: container.path,
        table: loaded.tableName,
        entryName: loaded.entry.name,
        entryIndex: loaded.entry.index,
        rowIds: [...input.rowIds],
        sourceHash: loaded.sourceHash,
        ...(sourceRevision !== undefined
            ? { sourceRevision, sourceRevisionKind: 'content-hash', contentRevision: sourceRevision }
            : {}),
        matchScope,
        matchMode,
        normalizedQuery: expanded.normalizedQuery,
        ...(expanded.conceptIds.length > 0 ? { conceptIds: expanded.conceptIds } : {}),
        droppedWeakMatches,
        ...(droppedFieldIds.length > 0 ? { droppedFieldIds } : {}),
        fields,
        ...(crossDomainFields.length > 0 ? { crossDomainFields } : {}),
        ...(nearestFields.length > 0 ? { nearestFields } : {}),
        ...pagination,
        diagnostics: loaded.diagnostics
    };
}
/**
 * 字段的三段匹配形。字段名/说明和查询都走同一条折叠（NFKC → 繁→简 → 小写），
 * 所以「距离」能匹配数据原文「判定距離」。折叠只发生在匹配形上，返回的 name 仍是原文。
 */
function fieldMatchForms(field) {
    return {
        id: foldFieldText(field.id),
        name: foldFieldText(field.name ?? ''),
        description: foldFieldText(field.description ?? '')
    };
}
/** A field id or display-name hit, as opposed to a prose mention in its description. */
function isStrongParamFieldMatch(field, queryTerms) {
    const { id, name } = fieldMatchForms(field);
    return queryTerms.some((term) => {
        const normalized = foldFieldText(term);
        return normalized.length > 0 && (id.includes(normalized) || (name.length > 0 && name.includes(normalized)));
    });
}
/**
 * How many query terms hit the field id or display name.
 *
 * `includeDescription` 只在给「说明命中」算召回门槛时打开：说明是弱证据，不能靠它决定
 * 名字命中要满足的覆盖度，否则散文里散落的短词会把多词查询的门槛抬到没人能过。
 */
function countParamFieldTermMatches(field, queryTerms, options = {}) {
    const { id, name, description } = fieldMatchForms(field);
    const prose = options.includeDescription === true ? description : '';
    return queryTerms.reduce((count, term) => {
        const normalized = foldFieldText(term);
        if (normalized.length === 0)
            return count;
        return id.includes(normalized) || (name.length > 0 && name.includes(normalized))
            || (prose.length > 0 && prose.includes(normalized)) ? count + 1 : count;
    }, 0);
}
function scoreParamFieldDefinition(field, queryTerms) {
    const { id, name, description } = fieldMatchForms(field);
    const type = field.type.toLowerCase();
    return queryTerms.reduce((sum, term) => {
        const normalized = foldFieldText(term);
        // A term in the stable field id is stronger than a prose mention in a
        // description. For example, ResourceItemLotParam descriptions mention
        // `resourceItemCategory01` on itemNum/lotBasePoint fields; returning those
        // first hid the actual category field behind the result limit.
        if (id === normalized)
            return sum + 100;
        if (id.includes(normalized))
            return sum + 60;
        if (name === normalized)
            return sum + 40;
        if (name.includes(normalized))
            return sum + 30;
        if (description.includes(normalized))
            return sum + 10;
        if (type.includes(normalized))
            return sum + 5;
        return sum;
    }, 0);
}
/**
 * 旧接口，保留给既有调用方：语义词表已移到 `fieldSemantics.ts` 的 FIELD_CONCEPTS，
 * 这里只做转发，避免两套中英词表各自漂移。
 */
export function expandParamFieldQuery(query) {
    return expandFieldQuery(query).matchTerms;
}
export async function setParamFields(input) {
    // Row creation shares this facade because both are one PARAM write through the same
    // write-param → write-bnd4 → Patch Engine path. Mixing the two in one call would make
    // "which operation created the row" ambiguous, so it is refused instead of guessed.
    if (input.create !== undefined) {
        if (input.edits.length > 0) {
            return {
                ok: false,
                error: {
                    code: 'PARAM_CREATE_WITH_EDITS_REJECTED',
                    message: 'create_param_row 不接受 edits：新行字段请放在 fields 里（可先用 copyFrom 复制整行）。'
                },
                diagnostics: []
            };
        }
        return createParamRow({ edit: input.edit, ...input.create, ...(input.containerPath ? { containerPath: input.containerPath } : {}) });
    }
    if (input.edits.length === 0) {
        return { ok: false, error: { code: 'PARAM_EDIT_EMPTY', message: '没有要写入的字段。' }, diagnostics: [] };
    }
    const container = await resolveGameparamContainer(input.edit.session.layers.overlayRoot, input.containerPath);
    if (!container.ok)
        return { ok: false, error: container.error, diagnostics: [] };
    const file = await input.edit.indexFile(container.path, 'param');
    const entries = await listParamEntries(input.edit, container.path);
    if (!entries.ok)
        return { ok: false, error: entries.error, diagnostics: entries.diagnostics };
    const grouped = groupParamEdits(input.edits);
    const before = [];
    const after = [];
    const changedTables = [];
    // Each table commit is its own Patch Engine operation. Keep the table→opId pairing so a
    // multi-table edit answers with every rollback handle instead of only the last one.
    const operations = [];
    const diagnostics = [];
    let containerHash = file.sha256 ?? await sha256Of(container.path);
    for (const [, tableEdits] of grouped) {
        const table = tableEdits[0].table;
        const rowIds = [...new Set(tableEdits.map((item) => item.rowId))];
        const loaded = await loadTableRows(input.edit, container.path, entries.entries, table, rowIds, false, true);
        if (!loaded.ok) {
            return { ok: false, error: loaded.error, diagnostics: [...diagnostics, ...loaded.diagnostics], before };
        }
        try {
            diagnostics.push(...loaded.diagnostics);
            const mutations = [];
            const bySlot = new Map();
            for (const edit of tableEdits) {
                let slot;
                if (edit.rowIndex !== undefined) {
                    slot = loaded.slots.find((s) => s.rowIndex === edit.rowIndex);
                    if (!slot) {
                        return {
                            ok: false,
                            error: { code: 'PARAM_ROW_NOT_FOUND', message: `${table} 物理行索引 ${edit.rowIndex} 不存在。` },
                            diagnostics,
                            before
                        };
                    }
                    if (slot.id !== edit.rowId) {
                        return {
                            ok: false,
                            error: {
                                code: 'PARAM_ROW_ID_MISMATCH',
                                message: `${table} 物理行索引 ${edit.rowIndex} 的 ID (${slot.id}) 与请求 ID (${edit.rowId}) 不匹配。`
                            },
                            diagnostics,
                            before
                        };
                    }
                    if (edit.expectedDataHash && !slot.dataHash.toLowerCase().includes(edit.expectedDataHash.toLowerCase())) {
                        return {
                            ok: false,
                            error: {
                                code: 'PARAM_ROW_HASH_MISMATCH',
                                message: `${table} 物理行索引 ${edit.rowIndex} 的数据哈希已过期。`
                            },
                            diagnostics,
                            before
                        };
                    }
                }
                else {
                    const candidates = loaded.slotsById.get(edit.rowId) ?? [];
                    if (candidates.length === 0) {
                        return {
                            ok: false,
                            error: { code: 'PARAM_ROW_NOT_FOUND', message: `${table}#${edit.rowId} 不存在。` },
                            diagnostics,
                            before
                        };
                    }
                    if (candidates.length > 1) {
                        return {
                            ok: false,
                            error: {
                                code: 'PARAM_ROW_AMBIGUOUS',
                                message: `${table}#${edit.rowId} 存在重复行 (${candidates.length} 个物理槽)；修改必须指定 rowIndex 和 expectedDataHash。`
                            },
                            diagnostics,
                            before
                        };
                    }
                    const candidate = candidates[0];
                    if (!candidate) {
                        return {
                            ok: false,
                            error: { code: 'PARAM_ROW_NOT_FOUND', message: `${table}#${edit.rowId} 不存在。` },
                            diagnostics,
                            before
                        };
                    }
                    slot = candidate;
                    if (edit.expectedDataHash && !slot.dataHash.toLowerCase().includes(edit.expectedDataHash.toLowerCase())) {
                        return {
                            ok: false,
                            error: {
                                code: 'PARAM_ROW_HASH_MISMATCH',
                                message: `${table}#${edit.rowId} 的数据哈希已过期。`
                            },
                            diagnostics,
                            before
                        };
                    }
                }
                if (!slot) {
                    return {
                        ok: false,
                        error: { code: 'PARAM_ROW_NOT_FOUND', message: `${table}#${edit.rowId} 不存在。` },
                        diagnostics,
                        before
                    };
                }
                const entry = bySlot.get(slot.rowIndex) ?? { slot, edits: [] };
                entry.edits.push(edit);
                bySlot.set(slot.rowIndex, entry);
            }
            for (const [, { slot, edits: rowEdits }] of bySlot) {
                const applied = applyEditsToRowBytes({
                    rowDataBase64: slot.dataBase64,
                    definition: loaded.definition,
                    edits: rowEdits.map((item) => ({ fieldId: item.fieldId, value: item.value }))
                });
                if (!applied.ok) {
                    return {
                        ok: false,
                        error: { code: applied.code, message: `${table}#${slot.id} (row ${slot.rowIndex}): ${applied.message}` },
                        diagnostics,
                        before
                    };
                }
                for (const edit of rowEdits) {
                    const field = loaded.definition.fields.find((item) => item.id === edit.fieldId);
                    before.push({
                        table: loaded.tableName,
                        rowId: slot.id,
                        rowIndex: slot.rowIndex,
                        dataHash: slot.dataHash,
                        ...(slot.name ? { rowName: slot.name } : {}),
                        fieldId: edit.fieldId,
                        ...(field?.name && field.name !== edit.fieldId ? { displayName: field.name } : {}),
                        ...(field?.description ? { description: field.description } : {}),
                        value: applied.before[edit.fieldId] ?? null
                    });
                    after.push({
                        table: loaded.tableName,
                        rowId: slot.id,
                        rowIndex: slot.rowIndex,
                        dataHash: createHash('sha256').update(Buffer.from(applied.nextDataBase64, 'base64')).digest('hex').toLowerCase(),
                        ...(slot.name ? { rowName: slot.name } : {}),
                        fieldId: edit.fieldId,
                        ...(field?.name && field.name !== edit.fieldId ? { displayName: field.name } : {}),
                        ...(field?.description ? { description: field.description } : {}),
                        value: applied.after[edit.fieldId] ?? null
                    });
                }
                if (applied.nextDataBase64 !== slot.dataBase64) {
                    mutations.push({
                        kind: 'upsert',
                        id: slot.id,
                        dataBase64: applied.nextDataBase64,
                        rowIndex: slot.rowIndex,
                        expectedDataHash: slot.dataHash
                    });
                }
            }
            if (mutations.length === 0)
                continue;
            const committed = await commitTableMutations({
                edit: input.edit,
                file: { ...file, sha256: containerHash },
                containerPath: container.path,
                containerHash,
                entry: loaded.entry,
                unpackedPath: loaded.unpackedPath,
                unpackedHash: loaded.sourceHash,
                expectedRowDataSize: loaded.definition.rowDataSize,
                mutations,
                title: `PARAM set ${mutations.length} row(s) in ${loaded.tableName}`
            });
            if (!committed.ok) {
                return { ok: false, error: committed.error, diagnostics: [...diagnostics, ...committed.diagnostics], before };
            }
            diagnostics.push(...committed.diagnostics);
            changedTables.push(loaded.tableName);
            if (committed.opId) {
                operations.push({ table: loaded.tableName, opId: committed.opId });
            }
            else {
                // A committed write whose receipt has no operation id cannot be rolled back by handle.
                // Say so instead of silently returning a shorter list; do not fabricate an id either.
                diagnostics.push({
                    severity: 'warning',
                    code: 'PARAM_OPERATION_ID_MISSING',
                    message: `${loaded.tableName} 的提交回执没有操作 id；这次写入只能靠操作日志按标题/时间定位。`,
                    sourceUri: pathToFileURL(container.path).href
                });
            }
            containerHash = committed.nextContainerHash;
            file.sha256 = containerHash;
            const refreshed = entries.entries.find((item) => item.index === loaded.entry.index);
            if (refreshed)
                refreshed.contentHash = '';
        }
        finally {
            const cleanupDiagnostic = await loaded.cleanup();
            if (cleanupDiagnostic)
                diagnostics.push(cleanupDiagnostic);
        }
    }
    return {
        ok: true,
        containerPath: container.path,
        before,
        after,
        changedTables,
        operations,
        opIds: operations.map((operation) => operation.opId),
        diagnostics
    };
}
/**
 * Where a new row belongs in the ordered native row table.
 *
 * Sekiro row tables are strictly ascending by row id; the game and every reference tool find a
 * row by walking/halving that order, so appending id 770064 after 3952050 (or after 770080) would
 * produce a table that reads back but is no longer the shape the format promises. Insert before
 * the first larger id. A table that is not strictly ascending (duplicates, hand-edited order) is
 * left alone: appending is the only choice that never re-sorts rows the caller did not ask to
 * move.
 */
export function computeParamRowInsertIndex(rows, rowId) {
    const ids = [...rows].sort((left, right) => left.rowIndex - right.rowIndex).map((row) => row.id);
    for (let index = 1; index < ids.length; index += 1) {
        if (ids[index - 1] >= ids[index])
            return ids.length;
    }
    const position = ids.findIndex((id) => id > rowId);
    return position === -1 ? ids.length : position;
}
const PARAM_ROW_NAME_ENCODINGS = new Set(['utf16le', 'shiftjis', 'ascii']);
/**
 * Pick the encoding a new row's name should use from the table's own pool. Sekiro row names are
 * UTF-16LE, but a table whose names decode as ASCII/Shift-JIS should not gain one UTF-16LE name.
 */
function defaultParamRowNameEncoding(rows) {
    for (const row of rows) {
        if (row.name && row.nameEncoding && PARAM_ROW_NAME_ENCODINGS.has(row.nameEncoding)) {
            return row.nameEncoding;
        }
    }
    return 'utf16le';
}
/**
 * One physical write target for a table spelling. A logical native type can back several
 * children (ATK_PARAM_ST → AtkParam_Npc + AtkParam_Pc); creating a row in "the" family table has
 * no single answer, so only an exact physical spelling is accepted there.
 */
function resolveWritableTableEntry(entries, table) {
    const candidates = findTableEntries(entries, table);
    if (candidates.length === 0) {
        return {
            ok: false,
            error: {
                code: 'PARAM_TABLE_NOT_FOUND',
                message: `容器内没有表 ${table}。`,
                details: { available: entries.map((item) => basename(item.name.replace(/\\/g, '/'))) }
            }
        };
    }
    if (candidates.length === 1)
        return { ok: true, entry: candidates[0] };
    const token = normalizeTableToken(table);
    const exact = candidates.filter((entry) => normalizeTableToken(entry.name) === token);
    if (exact.length === 1)
        return { ok: true, entry: exact[0] };
    return {
        ok: false,
        error: {
            code: 'PARAM_TABLE_AMBIGUOUS',
            message: `${table} 对应多个物理表（${candidates.map((entry) => basename(entry.name.replace(/\\/g, '/'))).join(' / ')}），`
                + '创建行必须指定其中一张的物理表名。'
                + '这种拼写也不会给读证明 pin 内容版本（锚点必须落到唯一一张物理子表），所以只有直接给物理表名，'
                + '「这张表没被别的写入改过」才是被校验过的。',
            details: {
                requestedTable: table,
                candidates: candidates.map((entry) => ({
                    name: basename(entry.name.replace(/\\/g, '/')),
                    index: entry.index
                }))
            }
        }
    };
}
/** The one source row a copy request names, or a structured reason it cannot be used. */
function selectCopySourceSlot(slots, rowIndex) {
    if (slots === undefined || slots.length === 0) {
        return { ok: false, error: { code: 'PARAM_ROW_NOT_FOUND', message: 'copyFrom 指向的行不存在。' } };
    }
    if (rowIndex !== undefined) {
        const slot = slots.find((item) => item.rowIndex === rowIndex);
        return slot === undefined
            ? { ok: false, error: { code: 'PARAM_ROW_NOT_FOUND', message: `copyFrom 指向的物理行索引 ${rowIndex} 不存在。` } }
            : { ok: true, slot };
    }
    if (slots.length > 1) {
        return {
            ok: false,
            error: {
                code: 'PARAM_ROW_AMBIGUOUS',
                message: `copyFrom 指向的行存在 ${slots.length} 个物理槽；请同时给出 rowIndex。`,
                details: { rowIndexes: slots.map((slot) => slot.rowIndex) }
            }
        };
    }
    return { ok: true, slot: slots[0] };
}
/**
 * Create one PARAM row through the full Patch Engine path: unpack → write-param `add` → write-bnd4
 * → applyNativeMutation (staging, backup, journal, rollback handle) → native whole-table reread.
 *
 * The row is inserted at its sorted position in the ordered row table, never appended past larger
 * ids, and an occupied rowId is refused before any staging (`PARAM_ROW_ALREADY_EXISTS`). After the
 * commit every pre-existing row is re-read and compared by (id, dataHash), so "only the new row
 * changed" is a checked postcondition rather than an assumption about the writer.
 */
export async function createParamRow(input) {
    const { edit } = input;
    if (!Number.isSafeInteger(input.rowId) || input.rowId < -2147483648 || input.rowId > 2147483647) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'rowId 必须是 32 位有符号整数。' }, diagnostics: [] };
    }
    if (typeof input.rowName !== 'string' || input.rowName.trim().length === 0) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'rowName 必须是非空字符串。' }, diagnostics: [] };
    }
    if (input.nameEncoding !== undefined && !PARAM_ROW_NAME_ENCODINGS.has(input.nameEncoding)) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: 'nameEncoding 只接受 utf16le / shiftjis / ascii。' }, diagnostics: [] };
    }
    const container = await resolveGameparamContainer(edit.session.layers.overlayRoot, input.containerPath);
    if (!container.ok)
        return { ok: false, error: container.error, diagnostics: [] };
    const file = await edit.indexFile(container.path, 'param');
    const entries = await listParamEntries(edit, container.path);
    if (!entries.ok)
        return { ok: false, error: entries.error, diagnostics: entries.diagnostics };
    const target = resolveWritableTableEntry(entries.entries, input.table);
    if (!target.ok)
        return { ok: false, error: target.error, diagnostics: [] };
    const diagnostics = [];
    const loaded = await loadTableRowsFromEntry(edit, container.path, target.entry, [], true, true);
    if (!loaded.ok) {
        return { ok: false, error: loaded.error, diagnostics: [...diagnostics, ...loaded.diagnostics] };
    }
    try {
        diagnostics.push(...loaded.diagnostics);
        const tableName = loaded.tableName;
        const existing = loaded.slotsById.get(input.rowId);
        if (existing !== undefined && existing.length > 0) {
            return {
                ok: false,
                error: {
                    code: 'PARAM_ROW_ALREADY_EXISTS',
                    message: `${tableName}#${input.rowId} 已存在，创建行绝不覆盖既有行。`,
                    details: {
                        table: tableName,
                        rowId: input.rowId,
                        rows: existing.map((slot) => ({
                            rowIndex: slot.rowIndex,
                            dataHash: slot.dataHash,
                            ...(slot.name ? { rowName: slot.name } : {})
                        }))
                    }
                },
                diagnostics
            };
        }
        let baseDataBase64;
        let copyReceipt;
        if (input.copyFrom !== undefined) {
            const copyRowId = input.copyFrom.rowId;
            if (!Number.isSafeInteger(copyRowId)) {
                return { ok: false, error: { code: 'INVALID_INPUT', message: 'copyFrom.rowId 必须是整数。' }, diagnostics };
            }
            const sameTable = input.copyFrom.table === undefined
                || normalizeTableToken(input.copyFrom.table) === normalizeTableToken(tableName);
            let sourceSlot;
            let sourceDefinition = loaded.definition;
            let sourceTableName = tableName;
            if (sameTable) {
                const picked = selectCopySourceSlot(loaded.slotsById.get(copyRowId), input.copyFrom.rowIndex);
                if (!picked.ok)
                    return { ok: false, error: picked.error, diagnostics };
                sourceSlot = picked.slot;
            }
            else {
                const sourceTarget = resolveWritableTableEntry(entries.entries, input.copyFrom.table);
                if (!sourceTarget.ok)
                    return { ok: false, error: sourceTarget.error, diagnostics };
                const sourceLoaded = await loadTableRowsFromEntry(edit, container.path, sourceTarget.entry, [copyRowId], false);
                if (!sourceLoaded.ok) {
                    return { ok: false, error: sourceLoaded.error, diagnostics: [...diagnostics, ...sourceLoaded.diagnostics] };
                }
                diagnostics.push(...sourceLoaded.diagnostics);
                const picked = selectCopySourceSlot(sourceLoaded.slotsById.get(copyRowId), input.copyFrom.rowIndex);
                if (!picked.ok)
                    return { ok: false, error: picked.error, diagnostics };
                sourceSlot = picked.slot;
                sourceDefinition = sourceLoaded.definition;
                sourceTableName = sourceLoaded.tableName;
            }
            // Bytes copied from another native type are not the same fields: refuse instead of writing
            // a row the destination definition would decode as garbage.
            if (sourceDefinition.typeName !== loaded.definition.typeName) {
                return {
                    ok: false,
                    error: {
                        code: 'PARAM_COPY_TYPE_MISMATCH',
                        message: `${sourceTableName} 的原生类型 ${sourceDefinition.typeName} 与 ${tableName} 的 ${loaded.definition.typeName} 不同，不能整行复制。`,
                        details: { sourceTable: sourceTableName, sourceType: sourceDefinition.typeName, targetTable: tableName, targetType: loaded.definition.typeName }
                    },
                    diagnostics
                };
            }
            if (sourceDefinition.rowDataSize !== loaded.definition.rowDataSize) {
                return {
                    ok: false,
                    error: {
                        code: 'PARAM_COPY_ROW_WIDTH_MISMATCH',
                        message: `${sourceTableName} 行宽 ${sourceDefinition.rowDataSize} 与 ${tableName} 行宽 ${loaded.definition.rowDataSize} 不同，不能整行复制。`,
                        details: { sourceRowDataSize: sourceDefinition.rowDataSize, targetRowDataSize: loaded.definition.rowDataSize }
                    },
                    diagnostics
                };
            }
            baseDataBase64 = sourceSlot.dataBase64;
            copyReceipt = {
                table: sourceTableName,
                rowId: copyRowId,
                ...(input.copyFrom.rowIndex !== undefined ? { rowIndex: input.copyFrom.rowIndex } : {})
            };
        }
        else {
            // No copy source means a literal zero row. The caller is responsible for every field that
            // must not stay zero (refs, ids); copyFrom is the safer way to seed a real row.
            baseDataBase64 = Buffer.alloc(loaded.definition.rowDataSize).toString('base64');
        }
        const applied = applyEditsToRowBytes({
            rowDataBase64: baseDataBase64,
            definition: loaded.definition,
            edits: input.fields ?? []
        });
        if (!applied.ok) {
            return { ok: false, error: { code: applied.code, message: `${tableName}#${input.rowId}: ${applied.message}` }, diagnostics };
        }
        const insertIndex = computeParamRowInsertIndex(loaded.slots, input.rowId);
        const nameEncoding = input.nameEncoding ?? defaultParamRowNameEncoding(loaded.slots);
        const dataHash = createHash('sha256')
            .update(Buffer.from(applied.nextDataBase64, 'base64'))
            .digest('hex')
            .toLowerCase();
        const mutation = {
            kind: 'add',
            id: input.rowId,
            dataBase64: applied.nextDataBase64,
            name: input.rowName,
            nameEncoding,
            insertIndex
        };
        const rowFields = input.fields ?? [];
        const before = [];
        const after = [];
        for (const field of rowFields) {
            const definition = loaded.definition.fields.find((item) => item.id === field.fieldId);
            const shared = {
                table: tableName,
                rowId: input.rowId,
                rowIndex: insertIndex,
                dataHash,
                rowName: input.rowName,
                fieldId: field.fieldId,
                ...(definition?.name && definition.name !== field.fieldId ? { displayName: definition.name } : {})
            };
            before.push({ ...shared, value: applied.before[field.fieldId] ?? null });
            after.push({ ...shared, value: applied.after[field.fieldId] ?? null });
        }
        let containerHash = file.sha256 ?? await sha256Of(container.path);
        const committed = await commitTableMutations({
            edit,
            file: { ...file, sha256: containerHash },
            containerPath: container.path,
            containerHash,
            entry: loaded.entry,
            unpackedPath: loaded.unpackedPath,
            unpackedHash: loaded.sourceHash,
            expectedRowDataSize: loaded.definition.rowDataSize,
            mutations: [mutation],
            title: `PARAM create #${input.rowId} in ${tableName}`
        });
        if (!committed.ok) {
            return { ok: false, error: committed.error, diagnostics: [...diagnostics, ...committed.diagnostics] };
        }
        diagnostics.push(...committed.diagnostics);
        containerHash = committed.nextContainerHash;
        if (committed.opId === undefined) {
            diagnostics.push({
                severity: 'warning',
                code: 'PARAM_OPERATION_ID_MISSING',
                message: `${tableName} 的创建回执没有操作 id；这次写入只能靠操作日志按标题/时间定位。`,
                sourceUri: pathToFileURL(container.path).href
            });
        }
        // Whole-table native reread: the new row must exist at the position we asked for, and every
        // pre-existing row must still have exactly the bytes it had before the write.
        const verification = await verifyCreatedParamRow({
            edit,
            table: tableName,
            rowId: input.rowId,
            rowName: input.rowName,
            expectedDataHash: dataHash,
            expectedRowIndex: insertIndex,
            rowCountBefore: loaded.slots.length,
            beforeRows: loaded.slots.map((slot) => ({ id: slot.id, dataHash: slot.dataHash })),
            expectedFields: rowFields.map((field) => ({ fieldId: field.fieldId, value: applied.after[field.fieldId] ?? null })),
            containerPath: container.path
        });
        const created = {
            table: tableName,
            rowId: input.rowId,
            rowName: input.rowName,
            rowIndex: insertIndex,
            insertIndex,
            dataHash,
            nameEncoding,
            ...(copyReceipt === undefined ? {} : { copyFrom: copyReceipt }),
            beforeFields: applied.before,
            afterFields: applied.after,
            rowCountBefore: loaded.slots.length,
            rowCountAfter: loaded.slots.length + 1
        };
        return {
            ok: true,
            containerPath: container.path,
            before,
            after,
            changedTables: [tableName],
            operations: committed.opId === undefined ? [] : [{ table: tableName, opId: committed.opId }],
            opIds: committed.opId === undefined ? [] : [committed.opId],
            created,
            verification,
            diagnostics
        };
    }
    finally {
        const cleanupDiagnostic = await loaded.cleanup();
        if (cleanupDiagnostic)
            diagnostics.push(cleanupDiagnostic);
    }
}
/**
 * Re-read the whole target table from the committed container and verify a creation:
 * the row exists exactly once at `expectedRowIndex` with the expected name and data hash, the
 * requested field values decode back, and every pre-existing (id, dataHash) pair is still present.
 */
export async function verifyCreatedParamRow(input) {
    const container = await resolveGameparamContainer(input.edit.session.layers.overlayRoot, input.containerPath);
    if (!container.ok) {
        return { ok: false, code: 'PARAM_POST_COMMIT_READ_FAILED', message: container.error.message };
    }
    const entries = await listParamEntries(input.edit, container.path);
    if (!entries.ok) {
        return { ok: false, code: 'PARAM_POST_COMMIT_READ_FAILED', message: entries.error.message };
    }
    const target = resolveWritableTableEntry(entries.entries, input.table);
    if (!target.ok) {
        return { ok: false, code: target.error.code, message: target.error.message };
    }
    const loaded = await loadTableRowsFromEntry(input.edit, container.path, target.entry, [], false, true);
    if (!loaded.ok) {
        return { ok: false, code: 'PARAM_POST_COMMIT_READ_FAILED', message: loaded.error.message };
    }
    try {
        const tableName = loaded.tableName;
        const matches = loaded.slotsById.get(input.rowId) ?? [];
        if (matches.length !== 1) {
            return {
                ok: false,
                code: 'PARAM_CREATE_POSTCONDITION',
                message: `提交后 ${tableName}#${input.rowId} 有 ${matches.length} 个物理行，无法唯一确认新行。`,
                details: {
                    table: tableName,
                    rowId: input.rowId,
                    rowCountAfter: loaded.slots.length,
                    rowIndexes: matches.map((slot) => slot.rowIndex),
                    sourceHash: loaded.sourceHash
                }
            };
        }
        const created = matches[0];
        if (created.rowIndex !== input.expectedRowIndex) {
            return {
                ok: false,
                code: 'PARAM_CREATE_POSITION_MISMATCH',
                message: `新行落在了物理槽 ${created.rowIndex}，预期 ${input.expectedRowIndex}。`,
                details: { expectedRowIndex: input.expectedRowIndex, actualRowIndex: created.rowIndex }
            };
        }
        if (created.name !== input.rowName) {
            return {
                ok: false,
                code: 'PARAM_CREATE_NAME_MISMATCH',
                message: `新行名称回读为 ${JSON.stringify(created.name)}，预期 ${JSON.stringify(input.rowName)}。`,
                details: { expectedRowName: input.rowName, actualRowName: created.name ?? null }
            };
        }
        if (created.dataHash !== input.expectedDataHash) {
            return {
                ok: false,
                code: 'PARAM_CREATE_DATA_MISMATCH',
                message: '新行数据哈希与提交前不一致。',
                details: { expectedDataHash: input.expectedDataHash, actualDataHash: created.dataHash }
            };
        }
        if (loaded.slots.length !== input.rowCountBefore + 1) {
            return {
                ok: false,
                code: 'PARAM_CREATE_ROW_COUNT_MISMATCH',
                message: `行数从 ${input.rowCountBefore} 变为 ${loaded.slots.length}，预期正好 +1。`,
                details: { rowCountBefore: input.rowCountBefore, rowCountAfter: loaded.slots.length }
            };
        }
        // Multiset of (id, dataHash): duplicate ids are legal in a PARAM table, so counting per pair
        // is the only comparison that cannot hide a replaced row behind a same-id sibling.
        const remaining = new Map();
        for (const slot of loaded.slots) {
            const key = `${slot.id}\u0000${slot.dataHash}`;
            remaining.set(key, (remaining.get(key) ?? 0) + 1);
        }
        const missingExisting = [];
        for (const row of input.beforeRows) {
            const key = `${row.id}\u0000${row.dataHash}`;
            const count = remaining.get(key) ?? 0;
            if (count === 0) {
                missingExisting.push(row);
                continue;
            }
            remaining.set(key, count - 1);
        }
        if (missingExisting.length > 0) {
            return {
                ok: false,
                code: 'PARAM_CREATE_SIBLING_ROWS_CHANGED',
                message: `有 ${missingExisting.length} 个既有行的字节在创建后发生变化；新行不能以牺牲其它行为代价。`,
                details: {
                    missingCount: missingExisting.length,
                    missingExistingRows: missingExisting.slice(0, 16)
                }
            };
        }
        const ordered = [...loaded.slots].sort((left, right) => left.rowIndex - right.rowIndex);
        const previous = ordered[created.rowIndex - 1];
        const next = ordered[created.rowIndex + 1];
        const fieldValues = [];
        for (const field of input.expectedFields ?? []) {
            const observed = readFieldValue(created.dataBase64, loaded.definition, field.fieldId);
            fieldValues.push({ fieldId: field.fieldId, expected: field.value, observed });
            if (!Object.is(observed, field.value)) {
                return {
                    ok: false,
                    code: 'PARAM_CREATE_FIELD_MISMATCH',
                    message: `新行字段 ${field.fieldId} 回读为 ${JSON.stringify(observed)}，预期 ${JSON.stringify(field.value)}。`,
                    details: { fieldId: field.fieldId, expected: field.value, observed }
                };
            }
        }
        return {
            ok: true,
            details: {
                row: {
                    table: tableName,
                    rowId: created.id,
                    rowIndex: created.rowIndex,
                    rowName: created.name ?? null,
                    dataHash: created.dataHash
                },
                insertIndex: created.rowIndex,
                rowCountBefore: input.rowCountBefore,
                rowCountAfter: loaded.slots.length,
                preservedExistingRows: input.beforeRows.length,
                orderedNeighbors: {
                    previousId: previous?.id ?? null,
                    nextId: next?.id ?? null
                },
                fields: fieldValues,
                sourceHash: loaded.sourceHash
            }
        };
    }
    finally {
        await loaded.cleanup();
    }
}
async function commitTableMutations(input) {
    const { edit } = input;
    const allowedRoots = () => [...edit.allowedRoots(), dirname(input.unpackedPath)];
    const paramStage = await stageBridgeOutput({
        stagingRoot: edit.stagingRoot,
        prefix: 'param-field',
        fileName: `${safeSegment(input.entry.name)}.mutated`,
        allowedRoots,
        write: async (context) => commitParamMutationsViaBridge({
            sourcePath: input.unpackedPath,
            outputPath: context.outputPath,
            expectedDocumentHash: input.unpackedHash,
            expectedRowDataSize: input.expectedRowDataSize,
            allowedRoots: context.allowedRoots,
            writableRoots: context.writableRoots,
            mutations: input.mutations,
            timeoutMs: 120_000
        })
    });
    if (!paramStage.ok || !paramStage.bytes) {
        const diagnostics = [
            ...paramStage.diagnostics.map((item) => ({
                severity: item.severity,
                code: item.code,
                message: item.message,
                sourceUri: input.file.sourceUri
            })),
            ...(paramStage.result?.diagnostics ?? []).map((item) => ({
                severity: item.severity,
                code: item.code,
                message: item.message,
                sourceUri: input.file.sourceUri
            }))
        ];
        return {
            ok: false,
            error: { code: 'PARAM_FIELD_STAGE_FAILED', message: '字段改动未能产出裸 param 暂存文件，容器未被修改。' },
            diagnostics
        };
    }
    const childBase64 = paramStage.bytes.toString('base64');
    const outcome = await applyNativeMutation({
        file: input.file,
        sourceUri: input.file.sourceUri,
        expectedHash: input.containerHash,
        stagingRoot: edit.stagingRoot,
        allowedRoots: () => [...edit.allowedRoots()],
        stagingPrefix: 'parambnd',
        stagingFileName: `${basename(input.containerPath)}.repacked`,
        stageWrite: async (context) => {
            const written = await runBridge({
                command: 'write-bnd4',
                filePath: input.containerPath,
                resourceUri: input.file.sourceUri,
                allowedRoots: context.allowedRoots,
                writableRoots: context.writableRoots,
                timeoutMs: 180_000,
                maxFrameBytes: 32 * 1024 * 1024,
                ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {}),
                commandOptions: {
                    outputPath: context.outputPath,
                    mutation: 'replace',
                    expectedContainerHash: input.containerHash,
                    entryIndex: input.entry.index,
                    expectedChildHash: input.entry.contentHash || await sha256Of(input.unpackedPath),
                    contentBase64: childBase64
                }
            });
            return {
                ok: written.parseStatus !== 'failed'
                    && written.diagnostics.some((item) => item.code === 'BND4_STAGING_WRITE_VERIFIED'),
                diagnostics: written.diagnostics
            };
        },
        title: input.title,
        confirmActionLabel: '提交容器内 PARAM 字段变更'
    }, { commit: edit.commitPort });
    if (outcome.status !== 'committed' || !outcome.result.ok) {
        const diagnostics = outcome.status === 'failed'
            ? outcome.diagnostics
            : outcome.status === 'committed'
                ? outcome.result.diagnostics
                : [{
                        severity: 'error',
                        code: 'PARAM_WRITE_CANCELLED',
                        message: '写入被取消。',
                        sourceUri: input.file.sourceUri
                    }];
        return {
            ok: false,
            error: { code: diagnostics[0]?.code ?? 'PARAM_WRITE_FAILED', message: diagnostics[0]?.message ?? '容器写入失败。' },
            diagnostics
        };
    }
    return {
        ok: true,
        nextContainerHash: await sha256Of(input.containerPath),
        // The Patch Engine operation behind this table commit. Without it a multi-table edit has no
        // per-table rollback handle even though every table was committed separately.
        ...(outcome.result.opId ? { opId: outcome.result.opId } : {}),
        diagnostics: outcome.result.diagnostics
    };
}
async function loadTableRows(edit, containerPath, entries, table, rowIds, allowMissingRows = false, retainUnpackedPath = false, 
/**
 * Present when the caller needs field *values*: the rows are then decoded by the
 * Bridge. `fieldIds` narrows the decode to the fields being delivered (absent means
 * every field of the trusted definition). Omit the whole object for callers that only
 * need row identity/bytes (row enumeration, writer staging, read proofs).
 */
valueProjection) {
    // A native type name can back more than one physical child.  Resolve the
    // logical spelling to every candidate, then let the requested row ids pick
    // the one table that actually holds them.  Picking the first candidate (or
    // failing as "no such table") is what made ATK_PARAM_ST unreadable.
    const candidates = findTableEntries(entries, table);
    if (candidates.length === 0) {
        return {
            ok: false,
            error: {
                code: 'PARAM_TABLE_NOT_FOUND',
                message: `容器内没有表 ${table}。`,
                details: { available: entries.map((item) => basename(item.name.replace(/\\/g, '/'))) }
            },
            diagnostics: []
        };
    }
    if (candidates.length === 1) {
        const loaded = await loadTableRowsFromEntry(edit, containerPath, candidates[0], rowIds, retainUnpackedPath, false, valueProjection);
        if (!loaded.ok || loaded.missingRows.length === 0) {
            return loaded.ok ? finishLoadedTable(loaded, allowMissingRows) : loaded;
        }
        // The spelling is this child's own physical name, and the child does not
        // hold every requested row.  It may still be the stem of a shared native
        // type (BehaviorParam is BEHAVIOR_PARAM_ST, whose sibling BehaviorParam_PC
        // holds the PC-only rows).  Widen only AFTER the named child answered, so
        // an explicit physical name keeps answering for rows it owns, and accept
        // the widened read only when it resolves to exactly one complete child.
        // Anything less keeps the named child's own answer instead of turning a
        // concrete "缺少行" into an ambiguous family request.
        if (isExactPhysicalTableName(candidates[0], table)) {
            const siblings = paramFamilyEntries(entries, table)
                .filter((entry) => entry.index !== candidates[0].index);
            const widened = [];
            for (const sibling of siblings) {
                const rowSet = await loadTableRowsFromEntry(edit, containerPath, sibling, rowIds, retainUnpackedPath, false, valueProjection);
                if (rowSet.ok)
                    widened.push(rowSet);
            }
            const selection = selectParamTableRows([loaded, ...widened], rowIds);
            if (selection.status === 'complete') {
                for (const probe of [loaded, ...widened]) {
                    if (probe !== selection.chosen)
                        await probe.cleanup();
                }
                return finishLoadedTable(selection.chosen, allowMissingRows);
            }
            for (const probe of widened)
                await probe.cleanup();
        }
        return finishLoadedTable(loaded, allowMissingRows);
    }
    const probes = [];
    const failures = [];
    for (const candidate of candidates) {
        const loaded = await loadTableRowsFromEntry(edit, containerPath, candidate, rowIds, retainUnpackedPath, false, valueProjection);
        if (loaded.ok)
            probes.push(loaded);
        else
            failures.push(loaded);
    }
    if (probes.length === 0)
        return failures[0];
    const selection = selectParamTableRows(probes, rowIds);
    const chosen = selection.status === 'complete' || selection.status === 'partial'
        ? selection.chosen
        : undefined;
    if (chosen === undefined) {
        const candidateNames = candidates.map((entry) => basename(entry.name.replace(/\\/g, '/'))).join(' / ');
        const rowsFound = candidates.map((entry) => ({
            name: basename(entry.name.replace(/\\/g, '/')),
            index: entry.index,
            rowsFound: probes.find((probe) => probe.entry.index === entry.index)
                ?.slots.filter((slot) => rowIds.includes(slot.id)).map((slot) => slot.id) ?? []
        }));
        for (const probe of probes)
            await probe.cleanup();
        // No candidate contains any requested row: the rows are missing, not the
        // table.  Say so instead of calling a readable table ambiguous.
        if (selection.status === 'missing') {
            return {
                ok: false,
                error: {
                    code: 'PARAM_ROW_NOT_FOUND',
                    message: `${table} 的候选物理表（${candidateNames}）都没有行 ${rowIds.join(', ')}。先用 search_param_rows 按值搜索定位行 id。`,
                    details: { requestedTable: table, candidates: rowsFound, rows: rowIds }
                },
                diagnostics: []
            };
        }
        return {
            ok: false,
            error: {
                code: 'PARAM_TABLE_AMBIGUOUS',
                // Name the candidates this request actually met.  The old hint told
                // every caller to use `AtkParam_Npc / AtkParam_Pc`, which is a real
                // answer only for ATK_PARAM_ST and reads as nonsense for
                // BEHAVIOR_PARAM_ST.
                message: `${table} 对应多个物理表（${candidateNames}），`
                    + `请求的行 ${rowIds.join(', ')} 不能唯一落到其中一张表；请改用其中一张物理表名（${candidateNames}）后重试，或指定 rowIndex。`,
                details: { requestedTable: table, candidates: rowsFound, rows: rowIds }
            },
            diagnostics: []
        };
    }
    for (const probe of probes) {
        if (probe !== chosen)
            await probe.cleanup();
    }
    return finishLoadedTable(chosen, allowMissingRows);
}
/**
 * 这次写入（或写入前的内容锚点）将要落到的那张物理子表。
 *
 * 调用方拼写可以是一个原生类型名（`BEHAVIOR_PARAM_ST`），它同时对应
 * `BehaviorParam.param` 与 `BehaviorParam_PC.param`。锚点必须绑定到**实际那张子表**，
 * 否则「读 PC、写 PC」在同容器另一张表被写过之后会因为没有内容锚点而作废。
 * 这里复用写入路径自己的 `findTableEntries` + `selectParamTableRows` 判定，不另写一套
 * 拼写规则。
 *
 * 判定不出来（请求的行在多张候选表里都有 / 哪张都没有 / 原生读取失败 / 枚举失败）时
 * 返回 undefined：调用方必须按「没有内容锚点」失败关闭，绝不猜一张表。
 */
export async function resolveParamWriteTargetIdentity(input) {
    const rowIds = [...new Set(input.rowIds.filter((rowId) => Number.isSafeInteger(rowId)))];
    if (rowIds.length === 0)
        return undefined;
    const entries = await listParamEntries(input.edit, input.containerPath);
    if (!entries.ok)
        return undefined;
    // allowMissingRows 只用于拿到判定结果：行缺失/歧义本身返回失败，这里就不再提供锚点。
    const loaded = await loadTableRows(input.edit, input.containerPath, entries.entries, input.table, rowIds, true, false);
    if (!loaded.ok)
        return undefined;
    try {
        return { entryIndex: loaded.entry.index, tableName: loaded.tableName };
    }
    finally {
        // 锚点只需要身份，不需要这份解包字节。
        await loaded.cleanup();
    }
}
async function finishLoadedTable(loaded, allowMissingRows) {
    if (loaded.missingRows.length === 0)
        return loaded;
    if (allowMissingRows && loaded.slots.length > 0) {
        loaded.diagnostics.push({
            severity: 'warning',
            code: 'PARAM_ROWS_PARTIAL_MISSING',
            message: `${basename(loaded.entry.name.replace(/\\/g, '/'))} 未找到行：${loaded.missingRows.join(', ')}`
        });
        return loaded;
    }
    const diagnostics = loaded.diagnostics;
    await loaded.cleanup();
    return {
        ok: false,
        error: {
            code: 'PARAM_ROW_NOT_FOUND',
            message: `${basename(loaded.entry.name.replace(/\\/g, '/'))} 缺少行：${loaded.missingRows.join(', ')}。先用 search_param_rows 按值搜索定位行 id。`
        },
        diagnostics
    };
}
async function loadTableRowsFromEntry(edit, containerPath, entry, rowIds, retainUnpackedPath, 
/**
 * Read the whole ordered row table, not just `rowIds`. Row creation needs every row id to
 * place the new row at its sorted position, and needs every dataHash to prove afterwards that
 * no existing row's bytes changed.
 */
allRows = false, 
/** Decode the delivered cells with the Bridge; see `loadTableRows`. */
valueProjection) {
    // A single edit session can service concurrent reads (the Agent commonly
    // issues several PARAM probes in parallel).  Reusing one deterministic
    // output path lets extract-bnd4-child calls overwrite each other's bytes,
    // producing a misleading PARAM_UNPACK_FAILED or a mixed sourceHash.  Give
    // every load its own staging directory; the returned path remains available
    // to the writer when this read is followed by a mutation.
    await mkdir(edit.stagingRoot, { recursive: true });
    const unpackedDir = await mkdtemp(join(edit.stagingRoot, 'param-read-'));
    let cleaned = false;
    const cleanup = async () => {
        if (cleaned)
            return;
        cleaned = true;
        return cleanupParamTempDirectory({
            stagingRoot: edit.stagingRoot,
            tempDirectory: unpackedDir,
            containerPath
        });
    };
    const unpackedPath = join(unpackedDir, `${safeSegment(basename(entry.name.replace(/\\/g, '/')))}.${entry.index}.param`);
    const bridgeScope = createBridgeDaemonScope();
    let handedOff = false;
    let documentDiagnostics = [];
    let resultDiagnostics = documentDiagnostics;
    try {
        const extracted = await bridgeScope.run({
            command: 'extract-bnd4-child',
            filePath: containerPath,
            allowedRoots: [...edit.allowedRoots(), unpackedDir],
            writableRoots: [unpackedDir],
            ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {}),
            timeoutMs: 60_000,
            commandOptions: { entryIndex: entry.index, outputPath: unpackedPath }
        });
        if (extracted.parseStatus === 'failed') {
            resultDiagnostics = extracted.diagnostics;
            return {
                ok: false,
                error: { code: 'PARAM_UNPACK_FAILED', message: `解包 ${entry.name} 失败。` },
                diagnostics: resultDiagnostics
            };
        }
        if (extracted.data?.contentHash)
            entry.contentHash = extracted.data.contentHash;
        const readOnce = (includeAllPayloads) => readParamDocumentViaBridge({
            sourcePath: unpackedPath,
            allowedRoots: [...edit.allowedRoots(), unpackedDir],
            ...(includeAllPayloads
                // Whole-table reads must not be silently capped by the reader's default projection.
                ? { includeAllPayloads: true, maxRows: 1_000_000 }
                : { rowIds }),
            resolveRowDataSize: (header) => resolveTrustedParamRowWidth(header, edit.session.meta.game),
            timeoutMs: 120_000,
            maxFrameBytes: includeAllPayloads ? 32 * 1024 * 1024 : 8 * 1024 * 1024
        }, bridgeScope.run);
        let document = await readOnce(allRows);
        documentDiagnostics = asDiagnostics(document.diagnostics);
        resultDiagnostics = documentDiagnostics;
        if (!document.ok || !document.data) {
            return {
                ok: false,
                error: { code: 'PARAM_READ_FAILED', message: `读取 ${entry.name} 失败。` },
                diagnostics: documentDiagnostics
            };
        }
        const definition = await loadTrustedDefinition(document.data.typeName, document.data.rowDataSize, document.data.dataVersion, edit.session.meta.game);
        if (!definition.ok)
            return { ok: false, error: definition.error, diagnostics: documentDiagnostics };
        let sourceHash = document.data.sourceHash;
        const slots = [];
        const slotsById = new Map();
        const rows = new Map();
        const ingest = (items) => {
            slots.length = 0;
            slotsById.clear();
            rows.clear();
            for (let i = 0; i < items.length; i++) {
                const row = items[i];
                if (!row)
                    continue;
                if (typeof row.dataBase64 === 'string' && row.dataBase64.length > 0) {
                    const slot = {
                        rowIndex: row.rowIndex ?? i,
                        id: row.id,
                        dataBase64: row.dataBase64,
                        dataHash: row.dataHash ?? createHash('sha256').update(Buffer.from(row.dataBase64, 'base64')).digest('hex').toLowerCase(),
                        ...(row.name ? { name: row.name } : {}),
                        ...(row.nameEncoding ? { nameEncoding: row.nameEncoding } : {})
                    };
                    slots.push(slot);
                    const list = slotsById.get(row.id) ?? [];
                    list.push(slot);
                    slotsById.set(row.id, list);
                    rows.set(row.id, slot);
                }
            }
        };
        ingest(document.data.rows);
        let missing = rowIds.filter((id) => !slotsById.has(id));
        if (missing.length > 0) {
            const full = await readOnce(true);
            documentDiagnostics.push(...asDiagnostics(full.diagnostics));
            if (full.ok && full.data) {
                sourceHash = full.data.sourceHash;
                ingest(full.data.rows);
                missing = rowIds.filter((id) => !slotsById.has(id));
            }
        }
        if (valueProjection) {
            // Only the rows this read actually asks for carry cells: a whole-table fallback
            // above may have loaded every row, but decoding all of them is not this read.
            const requested = new Set(rowIds);
            const decoded = await decodeRowCellsViaBridge({
                run: bridgeScope.run,
                allowedRoots: [...edit.allowedRoots(), unpackedDir],
                unpackedPath,
                definition: definition.document,
                slots: slots.filter((slot) => requested.has(slot.id)),
                ...(valueProjection.fieldIds ? { fieldIds: valueProjection.fieldIds } : {})
            });
            if (!decoded.ok) {
                documentDiagnostics.push(...decoded.diagnostics);
                return {
                    ok: false,
                    error: { code: decoded.code, message: decoded.message },
                    diagnostics: documentDiagnostics
                };
            }
            if (decoded.unsupportedFieldIds.length > 0) {
                documentDiagnostics.push({
                    severity: 'warning',
                    code: 'PARAM_FIELD_TYPE_UNSUPPORTED',
                    message: `${basename(entry.name.replace(/\\/g, '/'))} 的字段 ${decoded.unsupportedFieldIds.slice(0, 8).join(', ')}`
                        + ' 没有解码器：原始字节已由 Bridge 保留，值以 null 交付，不是空值。'
                });
            }
        }
        handedOff = retainUnpackedPath;
        return {
            ok: true,
            tableName: basename(entry.name.replace(/\\/g, '/')).replace(/\.param$/i, ''),
            entry,
            definition: definition.document,
            slots,
            slotsById,
            rows,
            unpackedPath,
            sourceHash,
            missingRows: missing,
            diagnostics: documentDiagnostics,
            cleanup
        };
    }
    finally {
        try {
            await bridgeScope.dispose();
        }
        catch (error) {
            resultDiagnostics.push({
                severity: 'warning',
                code: 'BRIDGE_SCOPE_DISPOSE_FAILED',
                message: 'PARAM 读取专用 Bridge scope 清理失败，已保留本次读写结果。',
                sourceUri: pathToFileURL(containerPath).href,
                details: { errorName: error instanceof Error ? error.name : undefined }
            });
        }
        if (!retainUnpackedPath || !handedOff) {
            const cleanupDiagnostic = await cleanup();
            if (cleanupDiagnostic)
                resultDiagnostics.push(cleanupDiagnostic);
        }
    }
}
// One decoded page may use the Bridge's own maximum budget: the chunking below keeps
// every page far inside it. The per-cell estimate is deliberately generous (measured
// NpcParam cells are ~150 bytes), because a page that is still cut must be detected.
const PARAM_DECODE_CELL_PAGE_BYTES = 4 * 1024 * 1024;
const PARAM_DECODE_CELL_BYTES = 224;
const PARAM_DECODE_ROW_OVERHEAD_BYTES = 256;
function paramDecodeChunkRows(rowDataSize, fieldCount) {
    const estimate = PARAM_DECODE_ROW_OVERHEAD_BYTES
        + fieldCount * PARAM_DECODE_CELL_BYTES
        + Math.ceil((rowDataSize * 4) / 3);
    return Math.max(1, Math.min(512, Math.floor(PARAM_DECODE_CELL_PAGE_BYTES / Math.max(1, estimate))));
}
/**
 * Attach Bridge-decoded cells to the rows a native read already identified.
 *
 * Native row bytes become typed values in exactly one place — the Bridge
 * (`read-param-document` with `decodeFields`) — so this function contains no decoding
 * rule of its own. What it does own is the request: which fields are in the projection
 * (only the ones being delivered), how many rows one page may name (so the Bridge's
 * serialized-byte budget cannot cut a requested row unnoticed), and what a short page
 * means (re-read the few rows it dropped one at a time; never report a row as decoded
 * when it is not).
 *
 * `dataHash` is the identity check: the decoded page must hash the same row bytes the
 * identifying read reported, so a decode of different bytes (a concurrent writer, a
 * sibling table) fails instead of publishing values for a row nobody asked about.
 */
async function decodeRowCellsViaBridge(input) {
    if (input.slots.length === 0)
        return { ok: true, unsupportedFieldIds: [] };
    const wanted = input.fieldIds;
    const projection = wanted === undefined
        ? input.definition
        : { ...input.definition, fields: input.definition.fields.filter((field) => wanted.includes(field.id)) };
    if (projection.fields.length === 0)
        return { ok: true, unsupportedFieldIds: [] };
    const byRowIndex = new Map(input.slots.map((slot) => [slot.rowIndex, slot]));
    const pending = new Set(input.slots.map((slot) => slot.rowIndex));
    // A field whose type has no decoder is reported with its bytes instead of a zero, so
    // the caller must be told that the delivered `null` means "no decoder", not "empty".
    const unsupportedFieldIds = new Set();
    const chunkRows = paramDecodeChunkRows(input.definition.rowDataSize, projection.fields.length);
    const decodePage = async (ids) => {
        const page = await readParamDocumentViaBridge({
            sourcePath: input.unpackedPath,
            allowedRoots: input.allowedRoots,
            rowIds: [...ids],
            // The width is already proven by the trusted definition: the Bridge validates it
            // against the file instead of guessing, and a single-row PARAM needs no retry.
            expectedRowDataSize: input.definition.rowDataSize,
            decode: { paramdef: projection, cellPageBytes: PARAM_DECODE_CELL_PAGE_BYTES },
            timeoutMs: 120_000,
            maxFrameBytes: 16 * 1024 * 1024
        }, input.run);
        if (!page.ok || !page.data) {
            return {
                ok: false,
                code: 'PARAM_DECODE_READ_FAILED',
                message: `Bridge 未能解码 ${basename(input.unpackedPath)} 的字段。`,
                diagnostics: asDiagnostics(page.diagnostics)
            };
        }
        for (const row of page.data.rows) {
            const slot = byRowIndex.get(row.rowIndex);
            if (!slot || slot.id !== row.id)
                continue;
            if (row.dataHash !== slot.dataHash) {
                return {
                    ok: false,
                    code: 'PARAM_DECODE_ROW_MISMATCH',
                    message: `${basename(input.unpackedPath)} 行 ${row.id}（物理 ${row.rowIndex}）解码的字节哈希与读取结果不一致。`,
                    diagnostics: []
                };
            }
            slot.cells = row.cells ?? [];
            for (const cell of slot.cells) {
                if (cell.status === 'unsupported')
                    unsupportedFieldIds.add(cell.fieldId);
            }
            pending.delete(row.rowIndex);
        }
        // `rowsTruncated` is the only signal for a rowIds-filtered page: it reports
        // `hasMore: false` even when the byte budget stopped it before every row.
        return { ok: true, truncated: page.data.decode?.rowsTruncated === true };
    };
    const ids = [...new Set(input.slots.map((slot) => slot.id))];
    for (let start = 0; start < ids.length; start += chunkRows) {
        const chunk = ids.slice(start, start + chunkRows);
        const outcome = await decodePage(chunk);
        if (!outcome.ok)
            return outcome;
        if (!outcome.truncated)
            continue;
        // A single row is far inside any page budget, so re-reading the rows this chunk
        // lost one id at a time cannot truncate again; if it still returns nothing, the
        // row genuinely is not in this document and the caller must be told.
        for (const id of chunk) {
            if (!input.slots.some((slot) => slot.id === id && pending.has(slot.rowIndex)))
                continue;
            const retry = await decodePage([id]);
            if (!retry.ok)
                return retry;
        }
    }
    if (pending.size > 0) {
        const missing = [...pending].map((rowIndex) => byRowIndex.get(rowIndex)?.id ?? rowIndex);
        return {
            ok: false,
            code: 'PARAM_DECODE_ROW_MISSING',
            message: `${basename(input.unpackedPath)} 的行 ${missing.slice(0, 8).join(', ')} 已读取但没有解码结果。`,
            diagnostics: []
        };
    }
    return { ok: true, unsupportedFieldIds: [...unsupportedFieldIds] };
}
async function listParamEntries(edit, containerPath) {
    const dcx = await runBridge({
        command: 'read-dcx-document',
        filePath: containerPath,
        resourceUri: pathToFileURL(containerPath).href,
        allowedRoots: edit.allowedRoots(),
        ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {}),
        timeoutMs: 120_000
    });
    if (dcx.parseStatus === 'failed') {
        return {
            ok: false,
            error: { code: 'PARAM_CONTAINER_READ_FAILED', message: '无法枚举 parambnd 条目。' },
            diagnostics: dcx.diagnostics
        };
    }
    const raw = dcx.data?.nested?.entries ?? [];
    const entries = [];
    for (const [position, item] of raw.entries()) {
        const name = item.name ?? `entry_${position}`;
        if (!name.toLowerCase().endsWith('.param'))
            continue;
        entries.push({
            index: item.index ?? position,
            name,
            contentHash: item.contentHash ?? ''
        });
    }
    if (entries.length === 0) {
        return {
            ok: false,
            error: { code: 'PARAM_CONTAINER_EMPTY', message: '容器内没有 .param 条目。' },
            diagnostics: dcx.diagnostics
        };
    }
    return { ok: true, entries, diagnostics: dcx.diagnostics };
}
/**
 * Table-name aliases that are not a mechanical spelling of the native type.
 * `AttackParam` is the English name users and reference tools use for the
 * ATK_PARAM_ST family; the physical children are AtkParam_Npc / AtkParam_Pc.
 *
 * The rest are native type names whose physical child stem is different in this
 * game's gameparam.  They are needed because the PARAM header carries the native
 * type (`THROW_INFO_BANK`, `CACL_CORRECT_GRAPH_ST`, `ESTUS_FLASK_RECOVERY_PARAM_ST`)
 * while the BND4 child is named `ThrowParam`, `CalcCorrectGraph`,
 * `HPEstusFlaskRecoveryParam`/`MPEstusFlaskRecoveryParam`.  Without the alias the
 * reader answers `PARAM_TABLE_NOT_FOUND` for a table that really exists, which is
 * the same dead end as naming a table that does not exist.  Every pair here is
 * pinned by `paramTableAlias.test.ts` against the shipped-table inventory.
 */
const PARAM_TABLE_ALIASES = Object.freeze({
    attackparam: 'atkparam',
    calccorrectgraph: 'caclcorrectgraph',
    charainitparam: 'characterinitparam',
    hitmaterialspecialsettingparam: 'cshitmaterialspecialsettingparam',
    enemycommonparam: 'enemycommomparam',
    hpestusflaskrecoveryparam: 'estusflaskrecoveryparam',
    mpestusflaskrecoveryparam: 'estusflaskrecoveryparam',
    lodparam: 'lodbank',
    lodparamps4: 'lodbank',
    lodparamxb1: 'lodbank',
    newmenucolortableparam: 'menuparamcolortable',
    menuvaluetableparam: 'menuvaluetablespec',
    multihpestusflaskbonusparam: 'multiestusflaskbonusparam',
    multimpestusflaskbonusparam: 'multiestusflaskbonusparam',
    throwparam: 'throwinfobank'
});
/**
 * Resolve a caller table spelling to the logical family it names.  The
 * `_ST` type suffix and the known English alias are removed, while an
 * explicit physical child (`AtkParam_Npc`) keeps its own key so the two
 * siblings can still be distinguished.
 */
export function paramTableAliasKey(value) {
    const compact = normalizeTableToken(value).replace(/[^a-z0-9]+/gu, '');
    const withoutTypeSuffix = compact.endsWith('st') && compact.length > 2 ? compact.slice(0, -2) : compact;
    return PARAM_TABLE_ALIASES[withoutTypeSuffix] ?? withoutTypeSuffix;
}
/**
 * All physical entries a caller table spelling can name, most specific first.
 *
 * A native type can back several physical children: ATK_PARAM_ST is stored as
 * both AtkParam_Npc.param and AtkParam_Pc.param.  Returning every child lets
 * the loader disambiguate with the requested row ids; returning `undefined`
 * (the old behaviour) turned a readable table into "容器内没有表".
 */
export function findTableEntries(entries, wanted) {
    const token = normalizeTableToken(wanted);
    const exact = entries.filter((entry) => normalizeTableToken(entry.name) === token);
    if (exact.length > 0)
        return exact;
    // Bridge PARAM rows may expose the native type name (BEHAVIOR_PARAM_ST)
    // while the live container entry is the physical child (BehaviorParam.param).
    // The type suffix is not part of the physical name, so match both spellings.
    const wantedVariants = new Set(tableTokenVariants(wanted));
    const identityMatches = entries.filter((entry) => tableTokenVariants(entry.name).some((variant) => wantedVariants.has(variant)));
    // Identity matching alone is not the answer for a type name: the type stem
    // can also be the physical name of ONE child, and the siblings then differ
    // only by a suffix.  Returning the identity match by itself made
    // BEHAVIOR_PARAM_ST resolve to BehaviorParam alone and hid BehaviorParam_PC,
    // so a row that only the PC child holds was reported as missing.  Union the
    // two sets — identity matches first, then the rest of the family — and let
    // the loader disambiguate with the requested row ids.
    const family = paramFamilyEntries(entries, wanted);
    const merged = [...identityMatches];
    for (const entry of family) {
        if (!merged.some((known) => known.index === entry.index))
            merged.push(entry);
    }
    if (merged.length > 0)
        return merged;
    // Preserve the older prefix compatibility for callers that provide a
    // shortened physical name, but make it fail closed if more than one child
    // matches rather than silently choosing an arbitrary table.
    return entries.filter((entry) => {
        const name = normalizeTableToken(entry.name);
        return name.startsWith(`${token}param`) || token.startsWith(name);
    });
}
/**
 * Every physical child of the logical family a spelling names, in container
 * order.  `ATK_PARAM_ST`/`AtkParam`/`AttackParam` all name the atkparam family
 * (AtkParam_Npc + AtkParam_Pc); `BEHAVIOR_PARAM_ST` names BehaviorParam +
 * BehaviorParam_PC.  An explicit child spelling (`AtkParam_Pc`,
 * `BehaviorParam_PC`) only matches itself.
 */
function paramFamilyEntries(entries, wanted) {
    const wantedAlias = paramTableAliasKey(wanted);
    if (wantedAlias.length < 4)
        return [];
    return entries.filter((entry) => {
        const name = normalizeTableToken(entry.name);
        return paramTableAliasKey(entry.name) === wantedAlias || name.startsWith(wantedAlias);
    });
}
/** True when the spelling is exactly one physical child's own name. */
function isExactPhysicalTableName(entry, wanted) {
    return normalizeTableToken(entry.name) === normalizeTableToken(wanted);
}
/**
 * Which probed physical child answers this row request.
 *
 * A native type name can back several children, so a request is only servable
 * when exactly one child holds every requested row (`complete`) or, failing
 * that, when exactly one child holds any of them (`partial`).  Two complete
 * children (a row id that exists in both) and two partial children (the rows
 * are spread across siblings) are ambiguous: picking the first candidate would
 * silently read a table the caller did not ask for.
 */
export function selectParamTableRows(probes, rowIds) {
    const complete = probes.filter((probe) => probe.missingRows.length === 0);
    if (complete.length === 1)
        return { status: 'complete', chosen: complete[0] };
    if (complete.length > 1)
        return { status: 'ambiguous' };
    const partial = probes.filter((probe) => probe.missingRows.length < rowIds.length);
    if (partial.length === 1)
        return { status: 'partial', chosen: partial[0] };
    return partial.length === 0 ? { status: 'missing' } : { status: 'ambiguous' };
}
export function normalizeTableToken(value) {
    return basename(value.replace(/\\/g, '/'))
        .replace(/\.param$/i, '')
        .toLowerCase();
}
function tableTokenVariants(value) {
    const token = normalizeTableToken(value);
    const compact = token.replace(/[^a-z0-9]+/gi, '');
    if (compact.length === 0)
        return [];
    const variants = new Set([compact]);
    if (compact.endsWith('st') && compact.length > 2) {
        variants.add(compact.slice(0, -2));
    }
    return [...variants];
}
/**
 * One row's field value, in the value domain the read path publishes.
 *
 * `read_param_fields` itself projects Bridge cells: the Bridge is the only place a
 * native row is turned into a typed value. This helper exists for the **writer**,
 * which has to compute expected before/after values synchronously from the row bytes
 * it is about to hand to `write-param` — there is no Bridge decode for a row that is
 * not on disk yet. It therefore has to name the same values the read path names, and
 * it differs from `decodeRowFields`' raw output in exactly two places:
 *
 * - a byte blob (`bytes`/`dummy8`) is its bytes, not `null`: a one-byte blob is that
 *   byte, a wider one is lowercase hex — the convention both pinned reference tools
 *   use and the one `ParamFieldDecoder` implements;
 * - a non-finite float is the named literal JSON can carry (`NaN` / `Infinity` /
 *   `-Infinity`), because `JSON.stringify` would silently turn the numeric NaN into
 *   `null` and lose the difference between "undefined" and "not a number".
 *
 * Retiring this projection means giving the writer a Bridge primitive that decodes
 * arbitrary row bytes; until then it is the one remaining TS-side value projection,
 * kept to these two conventions so it cannot drift into a second decoder.
 */
function readFieldValue(rowDataBase64, definition, fieldId) {
    const bytes = Buffer.from(rowDataBase64, 'base64');
    const field = definition.fields.find((item) => item.id === fieldId);
    const decoded = decodeRowFields(bytes, definition).find((item) => item.fieldId === fieldId)?.value ?? null;
    if (!field)
        return decoded;
    const type = field.type.trim();
    if (type === 'bytes' || type === 'dummy8') {
        if (field.offset + field.size > bytes.length)
            return null;
        const slice = bytes.subarray(field.offset, field.offset + field.size);
        return slice.length === 1 ? slice[0] : slice.toString('hex');
    }
    if ((type === 'f32' || type === 'f64') && typeof decoded === 'number' && !Number.isFinite(decoded)) {
        return Number.isNaN(decoded) ? 'NaN' : decoded > 0 ? 'Infinity' : '-Infinity';
    }
    return decoded;
}
/**
 * Row width of a single-row 32-bit PARAM from the trusted first-party definition. The Bridge cannot bound such a row
 * alone (PARAM_ROW_SIZE_REQUIRED) and readParamDocumentViaBridge retries with this width. undefined when no definition
 * matches: the caller fails the read instead of guessing. compare/run.mjs uses it too, so the comparison drives the
 * same read path as the editor.
 */
export async function resolveTrustedParamRowWidth(header, game) {
    const definition = await loadTrustedDefinition(header.typeName, undefined, header.dataVersion, game);
    return definition.ok ? definition.document.rowDataSize : undefined;
}
/**
 * 可信字段定义（first-party ParamDefDocument），给 Bridge 的 decodeFields 用。
 * 与 resolveTrustedParamRowWidth 走同一条元数据链：类型名、数据版本、行宽必须
 * 唯一匹配；不匹配时返回 undefined，调用方不得改用猜测的字段布局解码。
 *
 * 解码本身在 Bridge（原生行字节的唯一生产权威）；这里只提供「哪些偏移是什么
 * 类型」的 schema，Bridge 拒绝任何 typeName/dataVersion/rowDataSize 不一致的定义。
 */
export async function resolveTrustedParamDefinition(header, game) {
    const definition = await loadTrustedDefinition(header.typeName, undefined, header.dataVersion, game);
    return definition.ok ? definition.document : undefined;
}
async function loadTrustedDefinition(typeName, rowDataSize, dataVersion, game) {
    if (!metadataCache)
        metadataCache = loadFirstPartyParamMetadata();
    if (!metadataCache.ok) {
        const first = metadataCache.diagnostics[0];
        return {
            ok: false,
            error: {
                code: first?.code ?? 'PARAM_FIRST_PARTY_SCHEMA_UNAVAILABLE',
                message: first?.message ?? 'SoulForge 内置 PARAM schema 不可用。'
            }
        };
    }
    const metadata = metadataCache.package;
    const descriptor = { game, gameBuild: '1.6', typeName, dataVersion: dataVersion ?? -1 };
    const width = rowDataSize ?? resolveParamMetadataRowWidth(metadata, descriptor);
    if (width === undefined) {
        return {
            ok: false,
            error: { code: 'PARAM_METADATA_TYPE_NOT_FOUND', message: `元数据包里没有唯一匹配类型 ${typeName} 和版本 ${dataVersion} 的定义。` }
        };
    }
    const matched = matchParamMetadataPackage(metadata, { ...descriptor, rowDataSize: width }, undefined);
    if (!matched.ok) {
        return {
            ok: false,
            error: {
                code: matched.diagnostics[0]?.code ?? 'PARAM_METADATA_MATCH_REJECTED',
                message: matched.diagnostics[0]?.message ?? '真实 PARAM 与可信字段定义不匹配。'
            }
        };
    }
    return { ok: true, document: { ...matched.definition.document, origin: 'first-party' } };
}
async function findParamBnd(root) {
    const hits = [];
    const walk = async (dir, depth) => {
        if (depth > 6 || hits.length > 8)
            return;
        let items = [];
        try {
            items = await readdir(dir);
        }
        catch {
            return;
        }
        for (const name of items) {
            const full = join(dir, name);
            let info;
            try {
                info = await stat(full);
            }
            catch {
                continue;
            }
            if (info.isDirectory()) {
                await walk(full, depth + 1);
            }
            else if (name.toLowerCase().endsWith('.parambnd.dcx')) {
                hits.push(full);
            }
        }
    };
    await walk(root, 0);
    return hits;
}
function asDiagnostics(items) {
    return items.map((item) => ({
        severity: item.severity === 'warning' || item.severity === 'info' ? item.severity : 'error',
        code: item.code,
        message: item.message
    }));
}
function safeSegment(name) {
    return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'param';
}
async function sha256Of(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}
//# sourceMappingURL=containerParamEdit.js.map