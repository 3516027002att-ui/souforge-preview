import { asIdList, asNumber, asOptionalString, asRecord, asString, asStringList, fail, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readParamFields, readParamRowsPage } from '../../param/containerParamEdit.js';
import { stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseParamFieldRefs } from '@soulforge/shared';
import { baseRootOf, parseReadOrigin, readOriginSource, resolveBaseOriginFile } from '../readOrigin.js';
/** Base-layer PARAM container: explicit path when given, otherwise the vanilla gameparam. */
async function resolveBaseParamContainer(context, containerPath) {
    if (containerPath)
        return resolveBaseOriginFile(context, containerPath);
    if (!baseRootOf(context))
        return resolveBaseOriginFile(context, 'param/gameparam/gameparam.parambnd.dcx');
    let firstFailure;
    for (const candidate of ['param/gameparam/gameparam.parambnd.dcx', 'param/gameparam.parambnd.dcx']) {
        const resolved = await resolveBaseOriginFile(context, candidate);
        if (resolved.ok)
            return resolved;
        firstFailure ??= resolved;
    }
    return firstFailure ?? await resolveBaseOriginFile(context, 'param/gameparam/gameparam.parambnd.dcx');
}
/** Workspace-relative POSIX spelling of the container that answered, for source.path. */
function containerRelativePath(context, absolutePath) {
    const root = context.session?.layers?.overlayRoot;
    if (root) {
        const rel = relative(root, absolutePath);
        if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))
            return rel.replaceAll('\\', '/');
    }
    return absolutePath.replaceAll('\\', '/');
}
/** read_param_fields: one domain tool declaration, schema and handler. */
export function createReadParamFieldsTool(deps = {}) {
    const readFields = deps.readParamFields ?? readParamFields;
    return {
        name: 'read_param_fields',
        description: 'Read live PARAM field values from the opened gameparam container. '
            + 'origin selects the layer: "workspace" (default) reads the opened workspace container, "base" reads the same relative container under the game base root (--base), i.e. the vanilla values. '
            + 'Use origin:"base" to answer "is this the original value or did the mod change it?"; every result carries source:{root,path} naming the layer that answered, and a base view is read-only. '
            + 'Pass table, row ids, and a non-empty explicit fieldIds array on every call; '
            + 'omitting fieldIds or passing an empty array is rejected to prevent unbounded row payloads. '
            + 'pageSize defaults to 32 (max 128); one window can deliver only part of a row, so compare '
            + 'fieldsRequested with fieldsDelivered, read rowsNotFullyDelivered / undeliveredFieldIds, and follow '
            + 'pagination.nextCursor when it is present. missingRows lists logical rows that do not exist; it is not '
            + 'a field-completeness signal. '
            + 'Use pageSize and the returned opaque cursor to read a large field window without loading the whole result envelope. '
            + 'offset is a zero-based index into the same stable field-cell list pagination.totalCount counts — the position '
            + 'nextCursor encodes — so offset=32 with pageSize=32 returns exactly the page nextCursor would have delivered, and '
            + 'pagination.offset echoes the position actually served. Pass offset or cursor, never both (INVALID_INPUT); prefer '
            + 'nextCursor across writes because only the cursor carries the sourceHash binding (STALE_READ_CURSOR), and an offset '
            + 'past totalCount is refused with PARAM_OFFSET_OUT_OF_RANGE instead of returning an empty page. '
            + 'Completeness is cumulative, and completenessScope says which reading applies. '
            + 'completenessScope="read": completeness, fieldsDelivered, rowsNotFullyDelivered and undeliveredFieldIds describe the '
            + 'whole read from cell 0 through the end of this page, because offset/nextCursor is a position in the same stable cell '
            + 'list totalCount counts — so the last page of a read reports complete and never re-lists rows an earlier page already '
            + 'delivered. completenessScope="page" is the degraded answer: the numbers cover only this page (the row-by-row retry '
            + 'merge stitches several windows, so no single position exists), and nothing is claimed about earlier pages. '
            + 'pagination.returnedCount is always just this page. '
            + 'Copy each returned fieldId, rowIndex, and dataHash into the matching write edit; '
            + 'the physical rowIndex is required when the read returned it. '
            + 'Every field and the evidence block carry sourceRevisionKind=content-hash plus contentRevision: '
            + 'it is derived from the PARAM child hash, so identical bytes keep it across a write+rollback and '
            + 'search_param_rows reports the same contentRevision (its own sourceRevision is the file mtime and is '
            + 'labelled file-mtime). Use contentRevision, not a mtime, as a CAS/cache key. '
            + 'Do not parse Smithbox XML or unpack BND yourself. Use the same explicit field ids for writes. '
            + 'For a drop chain (NpcParam.itemLotId_* → ItemLotParam slot → EquipParamGoods.isConsume), '
            + 'explain_drop_chain answers "does it unlock anything" in one call; reading the three rows here '
            + 'returns the values but never composes the verdict. '
            + 'Whole-table row enumeration: pass allRows:true with table, rowOffset and rowLimit (no rowIds/fieldIds). '
            + 'It returns row identities only (rowIndex/rowId/rowName) plus rowCount/rowReturned/hasMore/nextOffset. '
            + 'This is the read that can authorize create_param_row: the create gate requires the union of enumerated '
            + 'pages to cover every physical row [0, rowCount), so read from rowOffset=0 until hasMore=false. '
            + 'Reading a few rows (or one page) with fieldIds proves only those rows, never the whole table.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string',
            rowIds: 'array?',
            fieldIds: 'array?',
            containerPath: 'string?',
            cursor: 'string?',
            offset: 'safe-integer?',
            pageSize: 'number?',
            allRows: 'boolean?',
            rowOffset: 'safe-integer?',
            rowLimit: 'number?',
            origin: 'enum:workspace|base?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            const table = asString(value.table);
            const originParse = parseReadOrigin(value.origin);
            if (!originParse.ok)
                return fail(originParse.code, originParse.message);
            const origin = originParse.origin;
            // 来源解析只换根：base 时容器指向原版根下的同名文件，下面的原生读取路径完全不变。
            const requestedContainerPath = asOptionalString(value.containerPath);
            const baseContainer = origin === 'base'
                ? await resolveBaseParamContainer(context, requestedContainerPath)
                : undefined;
            if (baseContainer && !baseContainer.ok)
                return fail(baseContainer.code, baseContainer.message, baseContainer.details);
            const readContainerPath = baseContainer?.ok ? baseContainer.path : requestedContainerPath;
            // Model-facing container identity: the workspace branch already projects its
            // absolute path to a relative one, so a base read names the same relative file
            // instead of echoing a host path the caller must not reuse.
            const containerRef = baseContainer?.ok ? baseContainer.relativePath : readContainerPath;
            const allRows = value.allRows === true;
            if (allRows) {
                if (!table) {
                    return fail('INVALID_INPUT', 'read_param_fields 的整表行集枚举需要 table。');
                }
                const rowOffset = value.rowOffset === undefined ? 0 : asNumber(value.rowOffset, Number.NaN);
                if (!Number.isSafeInteger(rowOffset) || rowOffset < 0) {
                    return fail('INVALID_INPUT', 'read_param_fields 的 rowOffset 必须是 ≥0 的安全整数（0 表示第一页）。');
                }
                if (value.rowLimit !== undefined) {
                    const rowLimit = asNumber(value.rowLimit, Number.NaN);
                    if (!Number.isSafeInteger(rowLimit) || rowLimit < 1 || rowLimit > 512) {
                        return fail('INVALID_INPUT', 'read_param_fields 的 rowLimit 必须是 1–512 的安全整数。');
                    }
                }
                const edit = requireEditSession(context, 'read');
                if (!('session' in edit))
                    return edit;
                const page = await readParamRowsPage({
                    edit: edit.session,
                    table,
                    ...(readContainerPath ? { containerPath: readContainerPath } : {}),
                    rowOffset,
                    ...(value.rowLimit === undefined ? {} : { rowLimit: asNumber(value.rowLimit, 256) })
                });
                if (!page.ok)
                    return fail(page.error.code, page.error.message, page.error.details);
                const resolvedContainer = origin === 'workspace' && context.workspaceIndex
                    ? resolveIndexedResourceFile(context, page.containerPath, 'param')
                    : undefined;
                const sourceUri = baseContainer?.ok
                    ? baseContainer.sourceUri
                    : resolvedContainer && resolvedContainer.ok
                        ? resolvedContainer.sourceUri
                        : pathToFileURL(page.containerPath).href;
                return ok({
                    allRows: true,
                    containerPath: containerRef ?? page.containerPath,
                    table: page.table,
                    sourceUri,
                    source: readOriginSource(origin, baseContainer?.ok
                        ? baseContainer.relativePath
                        : containerRelativePath(context, page.containerPath)),
                    rowCount: page.rowCount,
                    rowOffset: page.rowOffset,
                    rowLimit: page.rowLimit,
                    rowReturned: page.rowReturned,
                    hasMore: page.hasMore,
                    ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
                    rows: page.rows,
                    sourceHash: page.sourceHash,
                    ...(page.sourceRevision === undefined ? {} : {
                        sourceRevision: page.sourceRevision,
                        sourceRevisionKind: 'content-hash',
                        contentRevision: page.sourceRevision
                    }),
                    diagnostics: page.diagnostics,
                    pagination: {
                        offset: page.rowOffset,
                        returnedCount: page.rowReturned,
                        totalCount: page.rowCount,
                        hasMore: page.hasMore,
                        ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset })
                    },
                    nextActions: page.hasMore ? [{
                            tool: 'read_param_fields',
                            args: {
                                table: page.table,
                                allRows: true,
                                rowOffset: page.nextOffset,
                                rowLimit: page.rowLimit,
                                ...(containerRef ? { containerPath: containerRef } : {}),
                                ...(origin === 'base' ? { origin: 'base' } : {})
                            },
                            reason: `继续枚举整表行集：还差 ${page.rowCount - (page.nextOffset ?? page.rowCount)} 行；翻到 hasMore=false 才能授权 create_param_row。`
                        }] : []
                });
            }
            const rowIds = asIdList(value.rowIds);
            const fieldIds = asStringList(value.fieldIds);
            const cursor = asOptionalString(value.cursor)?.trim();
            // offset is a cell index, not a row or field index. It is validated here so a contradictory
            // or malformed window fails before any native read instead of being forwarded to a boundary
            // that used to drop it.
            const offset = value.offset === undefined ? undefined : asNumber(value.offset, Number.NaN);
            const pageSize = value.pageSize === undefined ? undefined : Math.max(1, Math.min(128, Math.trunc(asNumber(value.pageSize, 32))));
            if (!table || rowIds.length === 0 || fieldIds.length === 0) {
                return fail('PARAM_FIELD_IDS_REQUIRED', 'read_param_fields 必须提供 table、非空 rowIds 和非空 fieldIds；请先从候选或元数据中确认真实字段 ID。');
            }
            if (value.offset !== undefined && (offset === undefined || !Number.isSafeInteger(offset) || offset < 0)) {
                return fail('INVALID_INPUT', 'read_param_fields 的 offset 必须是非负安全整数（0 表示第一页）；续页也可以用 pagination.nextCursor。');
            }
            if (cursor && offset !== undefined) {
                return fail('INVALID_INPUT', 'read_param_fields 的 cursor 与 offset 不能同时给出：续页只传 nextCursor 或只传 offset，避免两个位置互相矛盾。');
            }
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const readOnce = (ids) => readFields({
                edit: edit.session,
                queries: [{ table, rowIds: ids, fieldIds }],
                ...(readContainerPath ? { containerPath: readContainerPath } : {}),
                ...(cursor ? { cursor } : {}),
                ...(offset !== undefined ? { offset } : {}),
                ...(pageSize !== undefined ? { pageSize } : {})
            });
            let result = await readOnce(rowIds);
            // A row-by-row merge is several windows stitched together, not one position in one stable
            // cell list: the merged `pagination.offset`/`delivery` belong to the first single-row read
            // and would misdescribe the union. Remember it so completeness can say `page` instead.
            let mergedRowByRow = false;
            // One unknown row id in a batch made the native read come back empty, and the tool then reported
            // every requested row as missing, including rows that exist: a caller probing for existence was
            // told nothing exists. Retry row by row and merge, so the answer is "these exist, these do not".
            if (!result.ok && result.error.code === 'PARAM_ROW_NOT_FOUND' && rowIds.length > 1) {
                let merged;
                const missing = [];
                for (const rowId of rowIds) {
                    const single = await readOnce([rowId]);
                    if (!single.ok) {
                        if (single.error.code === 'PARAM_ROW_NOT_FOUND')
                            missing.push({ table, rowId });
                        continue;
                    }
                    if (merged === undefined) {
                        merged = single;
                        continue;
                    }
                    merged.fields.push(...single.fields);
                    merged.diagnostics.push(...single.diagnostics);
                    for (const definition of single.fieldDefinitions ?? []) {
                        if (!(merged.fieldDefinitions ?? []).some((known) => known.fieldId === definition.fieldId)) {
                            (merged.fieldDefinitions ??= []).push(definition);
                        }
                    }
                }
                if (merged !== undefined) {
                    merged.missingRows = [...merged.missingRows, ...missing];
                    merged.diagnostics.push({
                        severity: 'warning',
                        code: 'PARAM_ROWS_PARTIAL_MISSING',
                        message: '批量读取中部分行不存在：' + missing.map((row) => row.table + '#' + row.rowId).join(', ') + '；其余行已返回。'
                    });
                    result = merged;
                    mergedRowByRow = true;
                }
            }
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.error.details);
            const resolvedContainer = origin === 'workspace' && context.workspaceIndex
                ? resolveIndexedResourceFile(context, result.containerPath, 'param')
                : undefined;
            const sourceUri = baseContainer?.ok
                ? baseContainer.sourceUri
                : resolvedContainer?.ok
                    ? resolvedContainer.sourceUri
                    : pathToFileURL(result.containerPath).href;
            const indexedFile = resolvedContainer?.ok
                ? context.workspaceIndex?.getFile(resolvedContainer.sourceUri)
                : undefined;
            // WorkspaceIndex reuses the name `sourceRevision` for a different value: the file
            // freshness token it compares against IndexedFile.mtimeMs in acceptNativeProjection and
            // getRagStaleChunkIds. The receipt's revision is content-derived and must not be copied
            // into the index version, or every live-read merge would look stale against the catalog.
            const indexRevision = await stat(result.containerPath)
                .then((value) => value.mtimeMs)
                .catch(() => indexedFile?.mtimeMs);
            // T09 step 3: the automatic proof is confirmed by the bridge AFTER the
            // bounded projection is delivered (createAgentToolBridge), not promoted
            // here from the raw tool result.
            //
            // 原版读取绝不能写进工作区索引：索引是「当前工作区是什么」的目录，把 base 的
            // 行值合并进去会让之后每一次工作区查询都返回原版值。
            if (origin === 'workspace' && context.workspaceIndex && result.fields.length > 0) {
                const rowsByPhysicalKey = new Map();
                for (const field of result.fields) {
                    const key = `${field.entryIndex ?? '?'}\u0000${field.entryName ?? field.table}\u0000${field.rowId}\u0000${field.rowIndex ?? '?'}`;
                    const bucket = rowsByPhysicalKey.get(key);
                    if (bucket) {
                        bucket.fields.push(field);
                    }
                    else {
                        rowsByPhysicalKey.set(key, {
                            rowId: field.rowId,
                            ...(field.rowIndex !== undefined ? { rowIndex: field.rowIndex } : {}),
                            ...(field.dataHash ? { dataHash: field.dataHash } : {}),
                            ...(field.entryName ? { entryName: field.entryName } : {}),
                            ...(field.entryIndex !== undefined ? { entryIndex: field.entryIndex } : {}),
                            ...(field.rowName ? { rowName: field.rowName } : {}),
                            fields: [field]
                        });
                    }
                }
                const provenanceFor = (fields) => {
                    const hashes = new Set(fields.map((field) => field.sourceHash).filter((hash) => Boolean(hash)));
                    return {
                        ...(hashes.size === 1 ? { sourceHash: [...hashes][0] } : {}),
                        ...(indexRevision !== undefined ? { sourceRevision: indexRevision } : {})
                    };
                };
                // A user-facing table alias is not a native child identity. Keep
                // separate returned entries separate, and retain the existing
                // outer/child/revision checks in WorkspaceIndex.mergeParamRows.
                const rowBuckets = [...rowsByPhysicalKey.values()];
                const rowsByNativeEntry = new Map();
                for (const bucket of rowBuckets) {
                    const key = JSON.stringify([bucket.entryName ?? null, bucket.entryIndex ?? null, bucket.fields[0].table]);
                    const entryRows = rowsByNativeEntry.get(key) ?? [];
                    entryRows.push(bucket);
                    rowsByNativeEntry.set(key, entryRows);
                }
                let changed = false;
                for (const entryRows of rowsByNativeEntry.values()) {
                    const nativeEntry = entryRows[0];
                    const nativeTable = nativeEntry.fields[0].table;
                    const exportProvenance = provenanceFor(entryRows.flatMap((bucket) => bucket.fields));
                    const accepted = context.workspaceIndex.mergeParamRows({
                        sourceUri,
                        paramName: nativeTable,
                        ...(nativeEntry.entryName ? { entryName: nativeEntry.entryName } : {}),
                        ...(nativeEntry.entryIndex !== undefined ? { entryIndex: nativeEntry.entryIndex } : {}),
                        ...exportProvenance,
                        rows: entryRows.map((bucket) => ({
                            // Duplicate physical rows must stay addressable: append the
                            // physical rowIndex to the URI when the native read provided one.
                            uri: `${sourceUri}#${nativeTable}/${bucket.rowId}${bucket.rowIndex === undefined ? '' : `@${bucket.rowIndex}`}`,
                            sourceUri,
                            paramName: nativeTable,
                            ...(bucket.entryName ? { entryName: bucket.entryName } : {}),
                            ...(bucket.entryIndex !== undefined ? { entryIndex: bucket.entryIndex } : {}),
                            rowId: bucket.rowId,
                            ...(bucket.rowIndex === undefined ? {} : { rowIndex: bucket.rowIndex }),
                            ...(bucket.dataHash ? { dataHash: bucket.dataHash } : {}),
                            ...(bucket.rowName ? { rowName: bucket.rowName } : {}),
                            ...provenanceFor(bucket.fields),
                            fields: bucket.fields.map((field) => {
                                const parsedRefs = field.refs ? parseParamFieldRefs(field.refs) : undefined;
                                return {
                                    ...(field.fieldId ? { fieldId: field.fieldId } : {}),
                                    name: field.displayName ?? field.fieldId,
                                    ...(field.description ? { description: field.description } : {}),
                                    value: field.value,
                                    // Trusted-metadata provenance only: the refs string came from
                                    // the same native document read as the row bytes.
                                    ...(parsedRefs && parsedRefs.targets.length > 0 ? { refs: parsedRefs.targets, refsProvenance: 'trusted-metadata' } : {}),
                                    ...(parsedRefs && parsedRefs.rejected.length > 0 ? { refsRejected: parsedRefs.rejected, refsProvenance: 'trusted-metadata' } : {})
                                };
                            })
                        }))
                    });
                    changed = accepted || changed;
                }
                if (changed) {
                    context.workspaceIndex.rebuildReferences();
                    await context.onSemanticEvidenceUpdated?.([sourceUri]);
                }
            }
            // T12 step 8: reading NpcParam no longer auto-attaches a crossReferences
            // web. Related context is obtained explicitly via find_references
            // (detail=context) or resolve_entity, so a plain field read stays light.
            // The page window cut the answer silently: 54 requested fields returned 32, one row came back
            // 5 of 9 and two rows 0 of 9, while scan.status stayed complete and missingRows was empty. Say
            // which rows lost fields, and do not call this delivery complete.
            //
            // H6 (round 52): completeness is a property of the whole read, not of the page. Scoring the
            // page alone made the second page of a 54-cell read re-list the rows page 1 had already
            // delivered and answer completeness=partial, so two pages that together delivered everything
            // still read as two incomplete reads. The position is known without any cross-process state:
            // pagination.offset (the value nextCursor encodes) indexes the same stable cell list
            // pagination.totalCount counts, and the cursor's scope hash pins table/rows/fields and order.
            // The param layer therefore reports the cumulative boundary in `delivery`; when that boundary
            // is absent or does not describe this result (the row-by-row retry merge stitches several
            // windows together), the answer degrades to this page and says so with completenessScope='page'
            // instead of publishing a number a caller would misread.
            const rawDelivery = result.delivery;
            const cumulativeDeliveredByRow = !mergedRowByRow && Array.isArray(rawDelivery?.deliveredRowCounts)
                ? new Map(rawDelivery.deliveredRowCounts
                    .filter((entry) => typeof entry?.rowId === 'number' && typeof entry?.delivered === 'number')
                    .map((entry) => [entry.rowId, entry.delivered]))
                : undefined;
            const pageDeliveredByRow = new Map();
            for (const field of (result.fields ?? [])) {
                pageDeliveredByRow.set(field.rowId, (pageDeliveredByRow.get(field.rowId) ?? 0) + 1);
            }
            const deliveredByRow = cumulativeDeliveredByRow ?? pageDeliveredByRow;
            const completenessScope = cumulativeDeliveredByRow === undefined ? 'page' : 'read';
            const rowsNotFullyDelivered = rowIds.map((rowId) => ({ rowId, delivered: deliveredByRow.get(rowId) ?? 0, requested: fieldIds.length }))
                .filter((item) => item.delivered < item.requested);
            // Count both sides of the window so "missingRows: []" cannot be read as "nothing is missing".
            // undeliveredFieldIds names the requested fields this read has not carried (either the page
            // window cut them or the table has no such field); a cursor says which of the two it was.
            const pageDeliveredFieldIds = new Set((result.fields ?? [])
                .map((field) => (typeof field.fieldId === 'string' ? field.fieldId : undefined))
                .filter((fieldId) => fieldId !== undefined));
            const undeliveredFieldIds = completenessScope === 'read' && Array.isArray(rawDelivery?.undeliveredFieldIds)
                ? rawDelivery.undeliveredFieldIds.filter((fieldId) => typeof fieldId === 'string')
                : fieldIds.filter((fieldId) => !pageDeliveredFieldIds.has(fieldId));
            const fieldsRequested = fieldIds.length * rowIds.length;
            const fieldsDelivered = completenessScope === 'read' && typeof rawDelivery?.cellsDeliveredThrough === 'number'
                ? rawDelivery.cellsDeliveredThrough
                : [...pageDeliveredByRow.values()].reduce((total, count) => total + count, 0);
            const hasMore = result.pagination?.hasMore === true;
            const deliveryComplete = rowsNotFullyDelivered.length === 0 && undeliveredFieldIds.length === 0 && !hasMore;
            // The scope sentence is always present: a caller must never have to guess whether
            // `completeness` means "the read so far" or "this page".
            const scopeNote = completenessScope === 'read'
                ? '完整性按整次读取累计（completenessScope=read，含之前各页）。'
                : '完整性只按本页统计（completenessScope=page），不代表之前各页。';
            const deliveryNote = scopeNote + ' ' + (deliveryComplete
                ? '本次统计内已交付全部请求字段格；pagination.returnedCount 只是本页交付的格数。missingRows 只表示逻辑行不存在。'
                : rowsNotFullyDelivered.length === 0
                    ? '请求的字段没有全部交付：有 nextCursor 时继续读，否则说明该表没有这些字段（以 fieldDefinitions 为准）。missingRows 只表示逻辑行不存在，不代表字段齐全。'
                    : '这些行没有拿到全部请求字段——可能是分页窗口截断，也可能是这次请求了表里不存在的字段；有 hasMore/nextCursor 时请继续读，不要把本次结果当成完整行。missingRows 只表示逻辑行不存在，不代表字段齐全。');
            const { delivery: _nativeDelivery, ...resultWithoutDelivery } = result;
            return ok({
                ...resultWithoutDelivery,
                ...(baseContainer?.ok ? { containerPath: baseContainer.relativePath } : {}),
                ...(completenessScope === 'read' && _nativeDelivery !== undefined ? { delivery: _nativeDelivery } : {}),
                completenessScope,
                rowsNotFullyDelivered,
                fieldsRequested,
                fieldsDelivered,
                undeliveredFieldCount: undeliveredFieldIds.length,
                undeliveredFieldIds: undeliveredFieldIds.slice(0, 32),
                deliveryNote,
                ...(deliveryComplete
                    ? {}
                    : { execution: { ...(result.execution ?? {}), status: 'partial' } }),
                sourceUri,
                source: readOriginSource(origin, baseContainer?.ok
                    ? baseContainer.relativePath
                    : indexedFile?.relativePath ?? containerRelativePath(context, result.containerPath)),
                ...(indexedFile?.relativePath ? { sourcePath: indexedFile.relativePath } : {})
            });
        }
    };
}
//# sourceMappingURL=read_param_fields.js.map