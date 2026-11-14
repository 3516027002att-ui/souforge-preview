/**
 * PARAM Bridge stage helpers — writers only touch staging; callers commit via Patch Engine.
 */
import type { ParamDefDocument } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
/**
 * backup/previous 路径判定（ROUTE-06：`.bak/.prev` History-only）。
 *
 * 与 artifact matcher 的判定语义一致：大小写不敏感后缀。IPC 层读取 PARAM 前
 * 先拒绝，不依赖路由层单点防线——绕过路由直接 invoke readParamDocument 的
 * 路径（调试工具、遗留调用方）也要被同一把锁挡住。
 */
export declare function isParamBackupPath(relativePath: string): boolean;
export type ParamBridgeMutation = {
    kind: 'upsert';
    id: number;
    dataBase64: string;
    rowIndex?: number;
    expectedDataHash?: string;
    expectedRowDataSize?: number;
} | {
    kind: 'delete';
    id: number;
    rowIndex?: number;
    expectedDataHash?: string;
    expectedRowDataSize?: number;
}
/**
 * New row. `insertIndex` is a position in the ordered native row table (Sekiro rows are
 * strictly ascending by id), not a physical row of the current snapshot: the Bridge validates
 * it against the working order and shifts every later row's data offset itself.
 * `nameEncoding` is utf16le / shiftjis / ascii.
 */
 | {
    kind: 'add';
    id: number;
    dataBase64: string;
    name?: string;
    nameEncoding?: 'utf16le' | 'shiftjis' | 'ascii';
    insertIndex?: number;
    expectedRowDataSize?: number;
};
export interface ParamBridgeCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    expectedRowDataSize?: number;
    allowedRoots: string[];
    writableRoots: string[];
    mutation: ParamBridgeMutation;
    timeoutMs?: number;
}
export interface ParamBridgeBatchCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    expectedRowDataSize?: number;
    allowedRoots: string[];
    writableRoots: string[];
    mutations: ParamBridgeMutation[];
    timeoutMs?: number;
}
export interface ParamBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    rowCount?: number;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export declare function commitParamMutationViaBridge(request: ParamBridgeCommitRequest): Promise<ParamBridgeCommitResult>;
/** Batch upsert/delete. Bridge already accepts `mutations[]`; this is the TS wrapper. */
export declare function commitParamMutationsViaBridge(request: ParamBridgeBatchCommitRequest): Promise<ParamBridgeCommitResult>;
/**
 * One field value decoded by the Bridge from the row bytes. `status` is absent when
 * the field decoded; `unsupported` (no decoder for that type) and `non-finite`
 * (NaN/Infinity carried as the named literal) are explicit, never a zero.
 */
export interface ParamDecodedCell {
    fieldId: string;
    name: string;
    type: string;
    offset: number;
    size: number;
    value?: number | string | boolean | null;
    status?: 'unsupported' | 'non-finite';
    rawHex?: string;
    encoding?: string;
    diagnostic?: string;
}
/** Row projection of a decoded read: the exact row bytes plus the decoded cells. */
export interface ParamDecodedRow {
    rowIndex: number;
    id: number;
    dataBase64: string;
    dataHash: string;
    name?: string;
    nameEncoding?: string;
    cells?: ParamDecodedCell[];
}
/** Envelope metadata of a decoded read; `hasMore`/`nextOffset` describe the next physical row. */
export interface ParamFieldDecodeMetadata {
    fieldLayout: 'paramdef-decoded';
    fieldCount: number;
    paramdef: {
        typeName: string;
        dataVersion: number;
        rowDataSize: number;
        fieldCount: number;
        digest: string;
        source: string;
    };
    uncoveredRanges: Array<{
        offset: number;
        size: number;
    }>;
    uncoveredByteCount: number;
    unsupportedFields: Array<{
        fieldId: string;
        type: string;
    }>;
    unsupportedFieldCount: number;
    cellPageBytes: number;
    returnedBytes: number;
    returnedCellCount: number;
    returnedRowCount: number;
    rowOffset: number;
    hasMore: boolean;
    nextOffset?: number;
    /**
     * True when the serialized-byte budget stopped the page (`hasMore` is the other
     * reason: physical rows remain). A read filtered by `rowIds` reports
     * `hasMore: false` even when the budget cut rows, so a caller that asked for
     * specific rows must check this instead of assuming every requested row came back.
     */
    rowsTruncated: boolean;
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
export declare function readParamDocumentViaBridge(input: {
    sourcePath: string;
    allowedRoots: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
    maxRows?: number;
    /** When set, Bridge returns only these rows with payloads. */
    rowIds?: number[];
    includeAllPayloads?: boolean;
    /** Bridge-side field decoding against a trusted definition (resolveTrustedParamDefinition). */
    decode?: {
        paramdef: ParamDefDocument;
        includeRawHex?: boolean;
        /** Serialized-byte budget of one decoded page (Bridge default 44 KiB). */
        cellPageBytes?: number;
    };
    /**
     * Row width the caller already proved for this PARAM (from the trusted definition).
     * The Bridge validates it against the file instead of re-deriving it, so a
     * single-row 32-bit PARAM needs no second round trip and a stale definition is a
     * hard failure rather than a guessed decode.
     */
    expectedRowDataSize?: number;
    maxFrameBytes?: number;
    maxConcurrency?: number;
    /** Resolve only from verified metadata; never infer ambiguous single-row boundaries. */
    resolveRowDataSize?: (header: {
        sourceHash: string;
        typeName: string;
        dataVersion: number;
    }) => Promise<number | undefined>;
}, bridge?: typeof runBridge): Promise<{
    ok: boolean;
    data?: {
        sourceHash: string;
        typeName: string;
        /** Native PARAM data version, when supplied by the Bridge envelope. */
        dataVersion?: number;
        rowCount: number;
        rowDataSize: number;
        rows: ParamDecodedRow[];
        authority?: string;
        /** Present only on a decoded read. */
        decode?: ParamFieldDecodeMetadata;
    };
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}>;
