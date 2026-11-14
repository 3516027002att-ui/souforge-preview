/**
 * Map EMEVD editor mutations → Bridge write-emevd staging commands.
 * Does not bypass Patch Engine: callers must commit staged bytes via PatchIR.
 */
import type { EmevdEditorMutation } from '@soulforge/shared';
export interface EmevdBridgeMutationRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutation: EmevdEditorMutation | EmevdBridgeNativeMutation;
    /** Optional global instruction index when applying args from Bridge sample indices. */
    instructionIndex?: number;
    timeoutMs?: number;
    oodleRuntimeRoot?: string | undefined;
}
/** Native Bridge mutation shapes (beyond editor IR). */
export type EmevdBridgeNativeMutation = {
    kind: 'set_rest_behavior';
    eventId: number;
    restBehavior: number;
} | {
    kind: 'update_id';
    eventId: number;
    newEventId: number;
} | {
    kind: 'add_event';
    newEventId: number;
    restBehavior?: number;
} | {
    kind: 'delete_event';
    eventId: number;
} | {
    kind: 'duplicate_event';
    eventId: number;
    newEventId: number;
} | {
    kind: 'set_instruction_args';
    instructionIndex: number;
    argsBase64: string;
    eventId?: number;
} | {
    /** 事件内插入一条指令；instructionIndex 是该事件内的位置（删除已应用后）。 */
    kind: 'insert_instruction';
    eventId: number;
    instructionIndex: number;
    bank: number;
    id: number;
    argsBase64: string;
} | {
    /** 删除事件内一条指令；instructionIndex 是原始文档中该事件内的下标。 */
    kind: 'delete_instruction';
    eventId: number;
    instructionIndex: number;
} | {
    kind: 'set_event_parameters';
    eventId: number;
    parameters: Array<{
        instructionIndex: number;
        targetStartByte: number;
        sourceStartByte: number;
        byteCount: number;
        unkId?: number;
    }>;
};
export interface EmevdBridgeCommitResult {
    ok: boolean;
    outputHash?: string;
    /** "emevd" for raw payload output; "dcx" when the staged artifact is a rebuilt outer DCX. */
    sourceFormat?: 'emevd' | 'dcx';
    /** SHA-256 of the outer container bytes (only for dcx output; the sealed file_replace expectation). */
    outerFileHash?: string;
    /** SHA-256 of the rebuilt EMEVD payload (for dcx output; reported as sourceHash by read-emevd-document). */
    payloadHash?: string;
    eventCount?: number;
    instructionCount?: number;
    mutationCount?: number;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
/** Batch variant: multiple mutations applied atomically by the C# writer (mutations array). */
export interface EmevdBridgeBatchRequest {
    sourcePath: string;
    outputPath: string;
    expectedDocumentHash: string;
    allowedRoots: string[];
    writableRoots: string[];
    mutations: EmevdBridgeNativeMutation[];
    timeoutMs?: number;
    oodleRuntimeRoot?: string | undefined;
}
/**
 * Write a single EMEVD mutation into a staging path via Bridge (production authority).
 */
export declare function commitEmevdMutationViaBridge(request: EmevdBridgeMutationRequest): Promise<EmevdBridgeCommitResult>;
/**
 * Apply an ordered batch of EMEVD mutations via Bridge in one staging write.
 * The C# writer re-reads the staged output and verifies every mutation before
 * reporting EMEVD_STAGING_WRITE_VERIFIED.
 */
export declare function commitEmevdBatchViaBridge(request: EmevdBridgeBatchRequest): Promise<EmevdBridgeCommitResult>;
