/**
 * Rebuild semantic projections for native files after a committed write.
 *
 * `scanWorkspace` only knows the outer file catalog.  Sekiro's EMEVD/MSB
 * files may be directly readable by Bridge, while PARAM/FMG semantic rows
 * live inside DCX/BND children.  Keeping this boundary here prevents the
 * post-commit refresh from declaring convergence after merely changing the
 * outer file hash.
 */
import type { Diagnostic, IndexedFile, ParamDefDocument, ParamFieldSymbol, ParamRowSymbol } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
import { WorkspaceIndex } from './workspaceIndex.js';
/** Internal test seam; production callers use the imported Bridge runner. */
type NativeSemanticBridgeRunner = typeof runBridge;
export interface NativeSemanticRefreshOptions {
    index: WorkspaceIndex;
    /** Bind any lazy native document session to the active workspace lifetime. */
    workspaceSessionId?: string;
    /**
     * The default preserves the caller's projection until every native read
     * succeeds. Use `isolated-candidate` only when the caller owns a disposable,
     * source-scoped index that is later merged into the active workspace. The
     * publish boundary rebuilds the complete reference graph, so the candidate
     * must not build a duplicate source-only graph before that merge.
     */
    indexOwnership?: 'caller-owned' | 'isolated-candidate';
    sourceFiles: readonly IndexedFile[];
    stagingRoot: string;
    allowedRoots?: readonly string[];
    oodleRuntimeRoot?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** @internal Test-only seam; never supplied by production IPC. */
    bridgeRunner?: NativeSemanticBridgeRunner;
    /** @internal Optional bounded per-table memory telemetry for investigating native refresh pressure. */
    paramReadProgress?: (progress: NativeParamReadProgress) => void;
    /**
     * Reference-only projection used by on-demand find_references enrichment.
     * Normal post-write refreshes keep their historical complete field rows.
     */
    referenceFieldsOnly?: boolean;
}
export interface NativeParamReadProgress {
    phase: 'read-start' | 'read-complete' | 'decode-start' | 'decode-complete' | 'upsert';
    sourceUri: string;
    entryName: string;
    entryIndex: number;
    entryCount: number;
    rowCount?: number;
    returnedRowCount?: number;
    heapUsedMb: number;
    rssMb: number;
}
export interface NativeSemanticRefreshResult {
    refreshedSources: string[];
    partialSources: string[];
    failedSources: string[];
    staleSources: string[];
    diagnostics: Diagnostic[];
}
/**
 * Refresh only the requested native source files.  A failed native read is
 * reported to the caller so the knowledge transaction can remain failed with
 * an empty semantic state instead of preserving stale rows.
 */
export declare function refreshNativeSemanticSources(input: NativeSemanticRefreshOptions): Promise<NativeSemanticRefreshResult>;
/**
 * Decode one native PARAM table into semantic rows in bounded event-loop
 * batches.  Keeping this loop as a small runtime unit makes its cancellation
 * and output-equivalence contract directly testable without needing a full
 * DCX/BND fixture.
 */
export declare function decodeNativeParamRows(input: {
    file: Pick<IndexedFile, 'sourceUri' | 'sha256' | 'mtimeMs'>;
    /** Hash of the decoded PARAM child payload, when known. */
    sourceHash?: string;
    /** Hash of the packed/outer source file, when known. */
    outerFileHash?: string;
    tableName: string;
    entryName: string;
    entryIndex: number;
    typeName: string;
    definition: ParamDefDocument;
    rows: readonly unknown[];
    signal?: AbortSignal;
    referenceFieldsOnly?: boolean;
    /** @internal Scoped to one native table; never retained by the live workspace. */
    fieldProjectionCache?: NativeParamFieldProjectionCache;
}): Promise<ParamRowSymbol[]>;
/** Primitive values share metadata cells; row vectors and physical receipts remain independent. */
export type NativeParamFieldProjectionCache = Map<string, {
    metadataKey: string;
    values: Map<string, ParamFieldSymbol>;
}>;
export {};
