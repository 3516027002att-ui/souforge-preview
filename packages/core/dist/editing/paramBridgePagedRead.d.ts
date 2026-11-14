import { runBridge, type RunBridgeOptions } from '../bridge/runBridge.js';
export interface ParamPagedReadOptions {
    sourcePath: string;
    allowedRoots: string[];
    workspaceSessionId?: string;
    /** Ephemeral refreshes use generation 0; the extracted child path is unique to the snapshot. */
    pathSourceGeneration?: number;
    /** Physical BND child identity, bound into the Bridge document-session cache key. */
    entryIdentity: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxFrameBytes?: number;
    expectedRowDataSize?: number;
    indexPageSize?: number;
    payloadBatchSize?: number;
    maxPayloadBytes?: number;
    maxRows?: number;
    onCancellationTerminal?: RunBridgeOptions['onCancellationTerminal'];
    resolveRowDataSize?: (header: {
        sourceHash: string;
        typeName: string;
        dataVersion: number;
    }) => Promise<number | undefined>;
    validateIdentity?: (identity: ParamPagedDocumentIdentity) => boolean | Promise<boolean>;
}
export interface ParamPagedDocumentIdentity {
    sourceHash: string;
    typeName: string;
    dataVersion: number;
    rowCount: number;
    rowDataSize: number;
    sessionToken: string;
    workspaceSessionId?: string;
    pathSourceGeneration: number;
}
export interface ParamPagedRowPayload {
    rowIndex: number;
    id: number;
    dataBase64: string;
    dataHash: string;
    name?: string;
}
export interface ParamPagedReadResult {
    ok: boolean;
    data?: ParamPagedDocumentIdentity;
    pagesRead: number;
    payloadBatchesRead: number;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
/**
 * Read one complete PARAM table through Bridge's lazy index and row-selection
 * API. The consumer receives only bounded payload batches; callers should hold
 * them only long enough to decode them and publish the export only after this
 * function returns `ok: true`.
 */
export declare function readParamDocumentRowsPagedViaBridge(input: ParamPagedReadOptions, consumeBatch: (identity: ParamPagedDocumentIdentity, rows: readonly ParamPagedRowPayload[]) => void | Promise<void>, bridge?: typeof runBridge): Promise<ParamPagedReadResult>;
