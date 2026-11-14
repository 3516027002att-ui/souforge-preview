/**
 * DCX DFLT (zlib) decompress / recompress for SoulForge container workbench.
 *
 * Supported: DCX with compression kind DFLT (zlib).
 * Unsupported (honest): KRAK / EDGE / ZSTD / unknown variants.
 *
 * Not a claim of every FromSoftware DCX layout — only layouts whose payload
 * boundary matches the reviewed DCS/DCP/DCA probe used by the bridge.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import type { CompressionKind, ContainerRoundTripReport } from './containerIr.js';
export interface DcxHeaderInfo {
    magic: string;
    headerVersion: number;
    compressionKind: CompressionKind;
    uncompressedSize: number;
    compressedSize: number;
    payloadOffset: number;
    dcsOffset: number;
    dcpOffset: number;
    dcaStart: number;
    dcaHeaderLength: number;
    compressionLevel: number;
    compressionSubFlag: number;
    /** Raw prefix bytes preserved for style-preserving recompress when possible. */
    headerPrefix: Buffer;
    boundaryConfirmed: boolean;
}
export interface DcxReadResult {
    ok: boolean;
    header?: DcxHeaderInfo;
    payload?: Buffer;
    payloadHash?: string;
    compressionKind: CompressionKind;
    decompressionStatus: 'supported' | 'unsupported' | 'failed' | 'none';
    diagnostics: StructuredDiagnostic[];
}
export interface DcxWriteResult {
    ok: boolean;
    bytes?: Buffer;
    hash?: string;
    payloadHash?: string;
    byteIdenticalToOriginal?: boolean;
    diagnostics: StructuredDiagnostic[];
}
/**
 * Parse DCX header and locate compressed payload boundary.
 */
export declare function parseDcxHeader(bytes: Buffer): {
    header?: DcxHeaderInfo;
    diagnostics: StructuredDiagnostic[];
};
/**
 * Full decompress of a DCX buffer. Only DFLT is supported.
 */
export declare function decompressDcx(bytes: Buffer): DcxReadResult;
/**
 * Build a standard SoulForge DCX-DFLT container around a payload.
 * Layout matches the common DCS/DCP/DCA style used by the bridge probe.
 */
export declare function compressDcxDflt(payload: Buffer, options?: {
    compressionLevel?: number;
    originalHeader?: DcxHeaderInfo;
}): DcxWriteResult;
/**
 * Recompress using original header style when possible; falls back to standard DFLT.
 * Guarantees payload-equivalent roundtrip for DFLT.
 */
export declare function recompressDcx(payload: Buffer, original?: Buffer): DcxWriteResult;
export declare function roundTripDcx(original: Buffer): ContainerRoundTripReport;
/** Build a synthetic unsupported DCX-like buffer (KRAK marker) for negative tests. */
export declare function buildUnsupportedDcxStub(payloadHint?: Buffer<ArrayBuffer>): Buffer;
