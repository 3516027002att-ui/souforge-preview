/**
 * PARAM Bridge stage helpers — writers only touch staging; callers commit via Patch Engine.
 */
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
/**
 * backup/previous 路径判定（ROUTE-06：`.bak/.prev` History-only）。
 *
 * 与 artifact matcher 的判定语义一致：大小写不敏感后缀。IPC 层读取 PARAM 前
 * 先拒绝，不依赖路由层单点防线——绕过路由直接 invoke readParamDocument 的
 * 路径（调试工具、遗留调用方）也要被同一把锁挡住。
 */
export function isParamBackupPath(relativePath) {
    const lower = relativePath.replaceAll('\\', '/').toLowerCase();
    return lower.endsWith('.bak') || lower.endsWith('.prev');
}
export async function commitParamMutationViaBridge(request) {
    return commitParamMutationsViaBridge({
        sourcePath: request.sourcePath,
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        ...(request.expectedRowDataSize !== undefined
            ? { expectedRowDataSize: request.expectedRowDataSize }
            : {}),
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        mutations: [request.mutation],
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {})
    });
}
/** Batch upsert/delete. Bridge already accepts `mutations[]`; this is the TS wrapper. */
export async function commitParamMutationsViaBridge(request) {
    if (request.mutations.length === 0) {
        return {
            ok: false,
            diagnostics: [{
                    severity: 'error',
                    code: 'PARAM_MUTATION_EMPTY',
                    message: 'write-param 需要至少一条 mutation。'
                }]
        };
    }
    const result = await runBridge({
        command: 'write-param',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        timeoutMs: request.timeoutMs ?? 60_000,
        commandOptions: {
            outputPath: request.outputPath,
            expectedDocumentHash: request.expectedDocumentHash,
            ...(request.expectedRowDataSize !== undefined
                ? { expectedRowDataSize: request.expectedRowDataSize }
                : {}),
            mutations: request.mutations.map(toBridgeMutation)
        }
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.param);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.rowCount !== undefined ? { rowCount: result.data.rowCount } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
/** One typed mutation → the exact JSON frame `write-param` accepts. */
function toBridgeMutation(mutation) {
    if (mutation.kind === 'upsert') {
        return {
            kind: 'upsert',
            id: mutation.id,
            dataBase64: mutation.dataBase64,
            ...(mutation.rowIndex !== undefined ? { rowIndex: mutation.rowIndex } : {}),
            ...(mutation.expectedDataHash !== undefined
                ? { expectedDataHash: mutation.expectedDataHash }
                : {}),
            ...(mutation.expectedRowDataSize !== undefined
                ? { expectedRowDataSize: mutation.expectedRowDataSize }
                : {})
        };
    }
    if (mutation.kind === 'add') {
        return {
            kind: 'add',
            id: mutation.id,
            dataBase64: mutation.dataBase64,
            ...(mutation.name !== undefined ? { name: mutation.name } : {}),
            ...(mutation.nameEncoding !== undefined ? { nameEncoding: mutation.nameEncoding } : {}),
            ...(mutation.insertIndex !== undefined ? { insertIndex: mutation.insertIndex } : {}),
            ...(mutation.expectedRowDataSize !== undefined
                ? { expectedRowDataSize: mutation.expectedRowDataSize }
                : {})
        };
    }
    return {
        kind: 'delete',
        id: mutation.id,
        ...(mutation.rowIndex !== undefined ? { rowIndex: mutation.rowIndex } : {}),
        ...(mutation.expectedDataHash !== undefined
            ? { expectedDataHash: mutation.expectedDataHash }
            : {}),
        ...(mutation.expectedRowDataSize !== undefined
            ? { expectedRowDataSize: mutation.expectedRowDataSize }
            : {})
    };
}
/**
 * Legacy materializing PARAM reader used by bounded editor reads/writes.
 * `maxRows` limits the returned projection after Bridge completes its request;
 * it is not a native payload or heap bound. Whole-table semantic refreshes
 * must use `readParamDocumentRowsPagedViaBridge` instead.
 *
 * `decode` opts into Bridge-side field decoding: the Bridge is the only place a
 * native row is turned into typed values, and the caller supplies the definition
 * so the Bridge never guesses a layout. One decoded page is bounded by a
 * serialized-byte budget, so a decoded read can return fewer rows than `rowCount`
 * even with a high `maxRows`: follow `decode.hasMore`/`decode.nextOffset`.
 * Without `decode` the rows are exactly the old shape (raw bytes only).
 */
export async function readParamDocumentViaBridge(input, bridge = runBridge) {
    const read = (commandOptions) => bridge({
        command: 'read-param-document',
        filePath: input.sourcePath,
        allowedRoots: input.allowedRoots,
        timeoutMs: input.timeoutMs ?? 60_000,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.maxFrameBytes !== undefined ? { maxFrameBytes: input.maxFrameBytes } : {}),
        ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
        commandOptions
    });
    const options = {
        ...(input.rowIds && input.rowIds.length > 0 ? { rowIds: input.rowIds } : {}),
        ...(input.includeAllPayloads ? { includeAllPayloads: true } : {}),
        ...(input.expectedRowDataSize !== undefined ? { expectedRowDataSize: input.expectedRowDataSize } : {}),
        ...(input.decode ? {
            decodeFields: true,
            paramdef: input.decode.paramdef,
            ...(input.decode.includeRawHex ? { includeRawHex: true } : {}),
            ...(input.decode.cellPageBytes !== undefined ? { cellPageBytes: input.decode.cellPageBytes } : {})
        } : {})
    };
    let result = await read(options);
    if (result.diagnostics.some((d) => d.code === 'PARAM_ROW_SIZE_REQUIRED') && input.resolveRowDataSize) {
        const headerResult = await read({ headerOnly: true });
        const header = headerResult.data;
        if (headerResult.parseStatus === 'failed' || !header?.sourceHash || !header.typeName
            || !Number.isInteger(header.dataVersion)) {
            return { ok: false, diagnostics: [...result.diagnostics, ...headerResult.diagnostics] };
        }
        const width = await input.resolveRowDataSize({
            sourceHash: header.sourceHash, typeName: header.typeName, dataVersion: header.dataVersion
        });
        if (!Number.isSafeInteger(width) || width <= 0) {
            return { ok: false, diagnostics: [...result.diagnostics, {
                        severity: 'error', code: 'PARAM_METADATA_ROW_WIDTH_UNRESOLVED',
                        message: '原生 PARAM 头部未唯一匹配可信字段定义，不能推测单行数据边界。'
                    }] };
        }
        result = await read({ ...options, expectedRowDataSize: width });
        if (result.parseStatus !== 'failed' && result.data?.sourceHash
            && (result.data.sourceHash !== header.sourceHash || result.data.typeName !== header.typeName
                || result.data.dataVersion !== header.dataVersion || result.data.rowDataSize !== width)) {
            return { ok: false, diagnostics: [{
                        severity: 'error', code: 'PARAM_METADATA_READ_IDENTITY_MISMATCH',
                        message: 'PARAM 完整读取与头部的来源、类型、版本或可信行宽不一致。'
                    }] };
        }
    }
    if (result.parseStatus === 'failed' || !result.data?.sourceHash) {
        return {
            ok: false,
            diagnostics: result.diagnostics.map((d) => ({
                severity: d.severity,
                code: d.code,
                message: d.message
            }))
        };
    }
    const maxRows = input.maxRows ?? 500;
    const effectiveMaxRows = input.rowIds && input.rowIds.length > 0
        ? Math.max(input.rowIds.length, maxRows)
        : maxRows;
    const rawRows = result.data.rows ?? [];
    const boundedRows = effectiveMaxRows === maxRows
        ? rawRows.slice(0, maxRows)
        : rawRows.slice(0, maxRows).concat(rawRows.slice(maxRows, effectiveMaxRows));
    const rows = boundedRows.map((r) => ({
        rowIndex: r.rowIndex,
        id: r.id,
        dataBase64: r.dataBase64,
        dataHash: r.dataHash,
        ...(r.name ? { name: r.name } : {}),
        ...(r.nameEncoding ? { nameEncoding: r.nameEncoding } : {}),
        // Decoded cells ride next to the untouched row bytes; the row is not rewritten.
        ...(r.cells ? { cells: r.cells } : {})
    }));
    return {
        ok: true,
        data: {
            sourceHash: result.data.sourceHash,
            typeName: result.data.typeName ?? 'UNKNOWN_PARAM',
            ...(result.data.dataVersion !== undefined
                ? { dataVersion: result.data.dataVersion }
                : {}),
            rowCount: result.data.rowCount ?? rows.length,
            rowDataSize: result.data.rowDataSize ?? 0,
            rows,
            ...(result.data.authority ? { authority: result.data.authority } : {}),
            ...(result.data.fieldLayout === 'paramdef-decoded' && result.data.paramdef ? {
                decode: {
                    fieldLayout: 'paramdef-decoded',
                    fieldCount: result.data.fieldCount ?? result.data.paramdef.fieldCount,
                    paramdef: result.data.paramdef,
                    uncoveredRanges: result.data.uncoveredRanges ?? [],
                    uncoveredByteCount: result.data.uncoveredByteCount ?? 0,
                    unsupportedFields: result.data.unsupportedFields ?? [],
                    unsupportedFieldCount: result.data.unsupportedFieldCount ?? 0,
                    cellPageBytes: result.data.cellPageBytes ?? 0,
                    returnedBytes: result.data.returnedBytes ?? 0,
                    returnedCellCount: result.data.returnedCellCount ?? 0,
                    returnedRowCount: result.data.returnedRowCount ?? rows.length,
                    rowOffset: result.data.rowOffset ?? 0,
                    hasMore: result.data.hasMore === true,
                    ...(result.data.nextOffset !== undefined ? { nextOffset: result.data.nextOffset } : {}),
                    rowsTruncated: result.data.rowsTruncated === true
                }
            } : {})
        },
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
//# sourceMappingURL=paramBridgeCommit.js.map