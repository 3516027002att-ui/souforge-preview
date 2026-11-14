/**
 * Bounded file preview for Files Mode.
 */
import { createDiagnostic } from '@soulforge/shared';
import { probeFile, DEFAULT_PROBE_PREFIX_BYTES } from '../vfs/boundedFileProbe.js';
import { getFileCapabilities } from './fileCapabilities.js';
export async function previewFileResource(input) {
    const maxBytes = input.maxBytes ?? DEFAULT_PROBE_PREFIX_BYTES;
    const probe = await probeFile(input.absolutePath, {
        maxPrefixBytes: maxBytes,
        deferHash: true
    });
    const capabilities = getFileCapabilities({
        absolutePath: input.absolutePath,
        relativePath: input.relativePath,
        looksBinary: probe.looksBinary
    });
    const diagnostics = [];
    if (capabilities.isPackedOrNative) {
        diagnostics.push(createDiagnostic({
            severity: 'info',
            code: 'PACKED_BOUNDED_PREVIEW',
            message: 'Packed/native-like file opened with bounded preview only. No native structured parse.',
            details: {
                relativePath: input.relativePath,
                nativeFormatAuthority: false,
                bytesRead: probe.bytesRead
            }
        }));
    }
    if (probe.size === 0) {
        return {
            absolutePath: input.absolutePath,
            relativePath: input.relativePath,
            size: 0,
            bytesRead: 0,
            truncated: false,
            previewKind: 'empty',
            capabilities,
            diagnostics,
            nativeFormatAuthority: false
        };
    }
    if (capabilities.isTextLike && !probe.looksBinary) {
        const text = probe.prefix.toString('utf8');
        return {
            absolutePath: input.absolutePath,
            relativePath: input.relativePath,
            size: probe.size,
            bytesRead: probe.bytesRead,
            truncated: probe.bytesRead < probe.size,
            previewKind: 'text',
            text,
            capabilities,
            diagnostics,
            nativeFormatAuthority: false
        };
    }
    const hex = probe.prefix.subarray(0, Math.min(probe.prefix.length, 256)).toString('hex');
    return {
        absolutePath: input.absolutePath,
        relativePath: input.relativePath,
        size: probe.size,
        bytesRead: probe.bytesRead,
        truncated: probe.bytesRead < probe.size,
        previewKind: 'hex',
        hex,
        capabilities,
        diagnostics,
        nativeFormatAuthority: false
    };
}
//# sourceMappingURL=filePreview.js.map