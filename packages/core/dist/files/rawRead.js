/**
 * Raw-level full/range read for any indexed file.
 * Preview prefixes remain separate; this API is honest about full vs range.
 */
import { createHash } from 'node:crypto';
import { open, readFile, stat } from 'node:fs/promises';
import { resolveResourceCapabilities } from '../capabilities/resourceCapabilities.js';
const DEFAULT_HASH_CAP_BYTES = 32 * 1024 * 1024;
export async function readRawResourceMetadata(file, options) {
    const capabilities = resolveResourceCapabilities(file);
    const st = await stat(file.absolutePath);
    const diagnostics = [...capabilities.diagnostics];
    const hashCap = options?.hashCapBytes ?? DEFAULT_HASH_CAP_BYTES;
    let contentHash;
    let hashStatus = 'deferred';
    if (options?.computeHash) {
        if (st.size <= hashCap) {
            const bytes = await readFile(file.absolutePath);
            contentHash = createHash('sha256').update(bytes).digest('hex');
            hashStatus = 'full';
        }
        else {
            hashStatus = 'deferred';
            diagnostics.push({
                severity: 'info',
                code: 'HASH_DEFERRED_LARGE_FILE',
                message: `Full content hash deferred for large file (${st.size} bytes > ${hashCap}).`,
                sourceUri: file.sourceUri
            });
        }
    }
    else {
        hashStatus = 'unavailable';
    }
    const looksBinary = !capabilities.isTextLike;
    return {
        sourceUri: file.sourceUri,
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        size: st.size,
        mtimeMs: st.mtimeMs,
        ...(contentHash ? { contentHash } : {}),
        hashStatus,
        formatKind: file.formatKind,
        compoundExtension: file.compoundExtension,
        looksBinary,
        capabilities,
        diagnostics
    };
}
export async function readRawResourceRange(file, offset, length) {
    const diagnostics = [];
    if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            offset,
            length,
            fileSize: 0,
            diagnostics: [{
                    severity: 'error',
                    code: 'RAW_RANGE_OFFSET_INVALID',
                    message: 'offset must be a non-negative integer.',
                    sourceUri: file.sourceUri
                }]
        };
    }
    if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            offset,
            length,
            fileSize: 0,
            diagnostics: [{
                    severity: 'error',
                    code: 'RAW_RANGE_LENGTH_INVALID',
                    message: 'length must be a non-negative integer.',
                    sourceUri: file.sourceUri
                }]
        };
    }
    // Cap single range to avoid memory blowups (16 MiB).
    const MAX_RANGE = 16 * 1024 * 1024;
    if (length > MAX_RANGE) {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            offset,
            length,
            fileSize: 0,
            diagnostics: [{
                    severity: 'error',
                    code: 'RAW_RANGE_TOO_LARGE',
                    message: `Single range length must be <= ${MAX_RANGE} bytes. Use multiple range reads.`,
                    sourceUri: file.sourceUri,
                    details: { length, max: MAX_RANGE }
                }]
        };
    }
    const st = await stat(file.absolutePath);
    if (offset > st.size || offset + length > st.size) {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            offset,
            length,
            fileSize: st.size,
            diagnostics: [{
                    severity: 'error',
                    code: 'RAW_RANGE_OOB',
                    message: 'Requested range is out of bounds for the file.',
                    sourceUri: file.sourceUri,
                    details: { offset, length, fileSize: st.size }
                }]
        };
    }
    const handle = await open(file.absolutePath, 'r');
    try {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buf, 0, length, offset);
        const slice = buf.subarray(0, bytesRead);
        return {
            ok: true,
            sourceUri: file.sourceUri,
            offset,
            length: bytesRead,
            fileSize: st.size,
            base64: slice.toString('base64'),
            sha256OfRange: createHash('sha256').update(slice).digest('hex'),
            diagnostics
        };
    }
    finally {
        await handle.close();
    }
}
export async function readTextResourceFull(file) {
    const caps = resolveResourceCapabilities(file);
    if (!caps.isTextLike) {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            byteLength: 0,
            encoding: 'invalid',
            diagnostics: [{
                    severity: 'error',
                    code: 'TEXT_FULL_READ_NOT_TEXT',
                    message: 'Full text read is only available for text-like files. Use raw range APIs for binary/packed files.',
                    sourceUri: file.sourceUri,
                    details: { formatKind: file.formatKind }
                }]
        };
    }
    const st = await stat(file.absolutePath);
    const MAX_TEXT = 64 * 1024 * 1024;
    if (st.size > MAX_TEXT) {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            byteLength: st.size,
            encoding: 'utf-8',
            diagnostics: [{
                    severity: 'error',
                    code: 'TEXT_FULL_READ_TOO_LARGE',
                    message: `File is too large for single full text read (${st.size} bytes). Use range reads.`,
                    sourceUri: file.sourceUri,
                    details: { size: st.size, max: MAX_TEXT }
                }]
        };
    }
    const bytes = await readFile(file.absolutePath);
    // UTF-8 validity check
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
        const text = decoder.decode(bytes);
        return {
            ok: true,
            sourceUri: file.sourceUri,
            text,
            byteLength: bytes.byteLength,
            contentHash: createHash('sha256').update(bytes).digest('hex'),
            encoding: 'utf-8',
            diagnostics: []
        };
    }
    catch {
        return {
            ok: false,
            sourceUri: file.sourceUri,
            byteLength: bytes.byteLength,
            encoding: 'invalid',
            diagnostics: [{
                    severity: 'error',
                    code: 'TEXT_INVALID_UTF8',
                    message: 'File is not valid UTF-8. Use raw range/binary APIs instead of text full read.',
                    sourceUri: file.sourceUri
                }]
        };
    }
}
//# sourceMappingURL=rawRead.js.map