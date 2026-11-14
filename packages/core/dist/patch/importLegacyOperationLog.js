import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
export class LegacyOperationLogImportError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
/**
 * Strict, idempotent JSON → workspace.db importer.
 * Corrupt input is surfaced and left untouched; it is never converted to an
 * empty history. A validated read-only backup is created before the DB commit.
 */
export async function importLegacyOperationLog(options) {
    let bytes;
    try {
        bytes = await readFile(options.sourcePath);
    }
    catch (error) {
        if (isMissing(error))
            return { status: 'source_missing', recordCount: 0 };
        throw new LegacyOperationLogImportError('LEGACY_OPERATION_LOG_READ_FAILED', '无法读取旧操作日志。', { cause: error instanceof Error ? error.message : String(error) });
    }
    const contentHash = sha256(bytes);
    const sourcePathHash = sha256(Buffer.from(normalizePath(options.sourcePath), 'utf8'));
    if (options.store.hasLegacyImport('operation_log_json_v1', sourcePathHash, contentHash)) {
        return { status: 'already_imported', recordCount: 0, contentHash };
    }
    const records = parseAndValidate(bytes, options.store.workspaceId);
    await mkdir(options.backupDirectory, { recursive: true });
    const backupPath = join(options.backupDirectory, `${basename(options.sourcePath)}.${contentHash.slice(0, 16)}.readonly.json`);
    await copyFile(options.sourcePath, backupPath);
    await chmod(backupPath, 0o444).catch(() => undefined);
    options.store.importLegacyRecords(records, {
        sourceKind: 'operation_log_json_v1',
        sourcePathHash,
        contentHash,
        importedAt: new Date().toISOString(),
        recordCount: records.length,
        backupPath
    });
    return {
        status: 'imported',
        recordCount: records.length,
        contentHash,
        backupPath
    };
}
function parseAndValidate(bytes, workspaceId) {
    let parsed;
    try {
        parsed = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        throw new LegacyOperationLogImportError('LEGACY_OPERATION_LOG_CORRUPT', '旧操作日志不是有效 JSON；未导入、未覆盖原文件。', { cause: error instanceof Error ? error.message : String(error) });
    }
    const entries = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed)
            && parsed.version === 1
            && Array.isArray(parsed.entries)
            ? parsed.entries
            : null;
    if (!entries) {
        throw new LegacyOperationLogImportError('LEGACY_OPERATION_LOG_SCHEMA_INVALID', '旧操作日志结构无效；预期 version=1 的 entries 数组。');
    }
    const seen = new Set();
    return entries.map((entry, index) => {
        if (!isRecord(entry))
            throw schemaError(index, 'entry must be an object');
        requireString(entry, 'opId', index);
        requireString(entry, 'workspaceId', index);
        requireString(entry, 'title', index);
        requireString(entry, 'createdAt', index);
        if (entry.workspaceId !== workspaceId)
            throw schemaError(index, 'workspaceId does not match the target database');
        if (seen.has(entry.opId))
            throw schemaError(index, 'duplicate opId');
        seen.add(entry.opId);
        if (entry.author !== 'user' && entry.author !== 'ai')
            throw schemaError(index, 'invalid author');
        if (!['plan', 'normal', 'fullPermission'].includes(String(entry.mode)))
            throw schemaError(index, 'invalid mode');
        if (![
            'planned',
            'pending',
            'staged',
            'validated',
            'committed',
            'rolled_back',
            'failed',
            'recovery_required'
        ].includes(String(entry.status)))
            throw schemaError(index, 'invalid status');
        if (!Array.isArray(entry.files))
            throw schemaError(index, 'files must be an array');
        if (!Array.isArray(entry.diagnostics))
            throw schemaError(index, 'diagnostics must be an array');
        entry.files.forEach((file, fileIndex) => validateFileRecord(file, index, fileIndex));
        return entry;
    });
}
function validateFileRecord(value, entryIndex, fileIndex) {
    if (!isRecord(value))
        throw schemaError(entryIndex, `files[${fileIndex}] must be an object`);
    for (const key of ['targetUri', 'targetPath', 'beforeHash', 'afterHash', 'backupPath', 'kind']) {
        if (typeof value[key] !== 'string' || value[key].length === 0) {
            throw schemaError(entryIndex, `files[${fileIndex}].${key} must be a non-empty string`);
        }
    }
}
function requireString(value, key, index) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
        throw schemaError(index, `${key} must be a non-empty string`);
    }
}
function schemaError(index, reason) {
    return new LegacyOperationLogImportError('LEGACY_OPERATION_LOG_SCHEMA_INVALID', `旧操作日志第 ${index} 条记录无效：${reason}。`);
}
function normalizePath(path) {
    const normalized = resolve(path);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isMissing(error) {
    return isRecord(error) && error.code === 'ENOENT';
}
//# sourceMappingURL=importLegacyOperationLog.js.map