/**
 * FMG Bridge stage helpers — writers only touch staging; callers commit via Patch Engine.
 */
export type FmgBridgeMutation = {
    kind: 'upsert';
    id: number;
    text: string | null;
    slotIndex?: number;
} | {
    kind: 'delete';
    id: number;
    slotIndex?: number;
} | {
    kind: 'add';
    id: number;
    text: string | null;
    slotIndex?: number;
};
export interface FmgBridgeCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutation: FmgBridgeMutation;
    /** msgbnd/DCX 容器写：FMG 表在 BND4 里的 child 下标。缺省 = loose profile。 */
    entryIndex?: number;
    timeoutMs?: number;
    disallowAmbiguous?: boolean;
}
export interface FmgBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    entryCount?: number;
    tableCount?: number;
    storageProfile?: 'loose' | 'msgbnd';
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export interface FmgBridgeBatchCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutations: FmgBridgeMutation[];
    entryIndex?: number;
    timeoutMs?: number;
    oodleRuntimeRoot?: string;
    disallowAmbiguous?: boolean;
}
export interface FmgTableMutationBatch {
    entryIndex: number;
    mutations: FmgBridgeMutation[];
}
export interface FmgBridgeMultiTableCommitRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    tables: FmgTableMutationBatch[];
    timeoutMs?: number;
    oodleRuntimeRoot?: string;
    disallowAmbiguous?: boolean;
}
export declare function commitFmgMutationViaBridge(request: FmgBridgeCommitRequest): Promise<FmgBridgeCommitResult>;
/** Batch upsert/delete/add. C# writer already accepts `mutations[]`. */
export declare function commitFmgMutationsViaBridge(request: FmgBridgeBatchCommitRequest): Promise<FmgBridgeCommitResult>;
export declare function commitFmgMultiTableViaBridge(request: FmgBridgeMultiTableCommitRequest): Promise<FmgBridgeCommitResult>;
export declare function readFmgDocumentViaBridge(input: {
    sourcePath: string;
    allowedRoots: string[];
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    data?: {
        sourceHash: string;
        entryCount: number;
        entries: Array<{
            id: number;
            text: string;
        }>;
        authority?: string;
    };
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}>;
