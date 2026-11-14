/**
 * Convert a DSL-compiled EmevdMutationPlan into Bridge-native batch mutations,
 * stage via Bridge, and commit through PatchIR + WorkspaceTransaction.
 *
 * DSL plan → Bridge mutations → staged bytes → file_replace PatchIR → commit → re-read.
 * Unknown instructions, opaque tails and layer variants are never re-encoded
 * (the DSL compiler already rejects them as read-only).
 */
import type { BridgeResult, EmevdEditorDocument, EmevdMutationPlan, PatchIR, ValidatorContract } from '@soulforge/shared';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { EmevdBridgeCommitResult, EmevdBridgeNativeMutation } from './emevdBridgeCommit.js';
export interface EmevdPlanCommitRequest {
    plan: EmevdMutationPlan;
    document: EmevdEditorDocument;
    registry: EmedfRegistry;
    sourcePath: string;
    /** SHA-256 of the decompressed EMEVD payload (Bridge write-emevd hash check). */
    expectedDocumentHash: string;
    /**
     * SHA-256 of the outer source resource file bytes (the .dcx wrapper). When
     * the source is a .dcx, the PatchIR file_replace content_hash precondition
     * must compare against the on-disk .dcx bytes — never the payload hash.
     */
    expectedOuterFileHash?: string;
    allowedRoots: string[];
    oodleRuntimeRoot?: string | undefined;
    timeoutMs?: number;
}
/** Production extensions: Patch Engine workspace + transaction wiring. */
export interface EmevdPlanPatchEngineCommitRequest extends EmevdPlanCommitRequest {
    workspaceId: string;
    /** Overlay root; the commit target must stay inside it. */
    workspaceRoot: string;
    /** Root where Bridge staging temp dirs are created (outside Mod/game dirs). */
    stagingRoot: string;
    targetUri?: string;
    title?: string;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
}
export interface EmevdReReadReport {
    ok: boolean;
    outputHash: string;
    /** Payload/source hash from the native re-read, when available. */
    sourceHash?: string;
    /** Outer container hash from the native re-read, when available. */
    outerFileHash?: string;
    eventCount: number;
    instructionCount: number;
    semanticIdentical: boolean;
    /** Committed file hash equals the Bridge-staged output hash. */
    byteConsistent: boolean;
}
export type EmevdTransactionStatus = 'not_committed' | 'committed';
/** Verification performed after the durable transaction changed the target. */
export interface EmevdNativeVerification {
    status: 'verified' | 'failed';
    code?: string;
    message?: string;
    details?: unknown;
}
export interface EmevdPlanCommitResult {
    ok: boolean;
    /** Explicitly distinguishes a rolled-back/failed transaction from a committed one. */
    transactionStatus?: EmevdTransactionStatus;
    /** Result of the independent post-commit Bridge re-read, when a file changed. */
    nativeVerification?: EmevdNativeVerification;
    outputHash?: string;
    /** Payload/source hash from Bridge staging, when DCX output exposes it. */
    payloadHash?: string;
    /** "emevd" for raw payload output; "dcx" when the staged artifact is a rebuilt outer DCX. */
    sourceFormat?: 'emevd' | 'dcx';
    /** Outer container hash of the staged artifact (dcx only). */
    outerFileHash?: string;
    eventCount?: number;
    instructionCount?: number;
    mutationCount: number;
    opId?: string;
    committedPath?: string;
    reRead?: EmevdReReadReport;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
export interface EmevdPostCommitReadInput {
    sourcePath: string;
    allowedRoots: string[];
    timeoutMs?: number;
    oodleRuntimeRoot?: string;
    sourceFormat: 'emevd' | 'dcx';
    expectedOutputHash: string;
    expectedPayloadHash?: string;
    opId: string;
    committedPath?: string;
    outputHash?: string;
    payloadHash?: string;
    outerFileHash?: string;
    eventCount?: number;
    instructionCount?: number;
    mutationCount: number;
    commitDiagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
    /** Narrow seam for deterministic post-commit failure tests. */
    read?: () => Promise<BridgeResult<EmevdReadEnvelope>>;
}
/**
 * Convert an EmevdMutationPlan into an ordered array of Bridge-native mutations.
 *
 * Ordering guarantees（C# writer 顺序应用，全局指令下标会随结构变化漂移）:
 * 0. set_instruction_args — 全局下标，必须在任何结构改动之前（按原始文档计算）
 * 1. delete_instruction — 事件内下标，同一事件内按下标降序
 * 2. insert_event（add_event 空事件，供后续 insert 引用）
 * 3. insert_instruction — 事件内下标（删除已应用后的列表），同一事件内升序
 * 4. delete_event — 放在指令级改动之后（其指令已随事件一起消失）
 * 5. set_rest_behavior
 * 6. update_id — 最后（改的是其他 mutation 引用的 eventId）
 */
export declare function planToBridgeMutations(plan: EmevdMutationPlan, document: EmevdEditorDocument, registry: EmedfRegistry): {
    ok: true;
    mutations: EmevdBridgeNativeMutation[];
} | {
    ok: false;
    code: string;
    message: string;
};
export interface EmevdPlanStageResult {
    ok: boolean;
    bytes?: Buffer;
    result?: EmevdBridgeCommitResult;
    /** "emevd" for raw payload output; "dcx" when the staged artifact is a rebuilt outer DCX. */
    sourceFormat?: 'emevd' | 'dcx';
    /** Outer container hash of the staged artifact (dcx only); the file_replace sealed expectation. */
    outerFileHash?: string;
    /** Rebuilt payload hash (dcx only). */
    payloadHash?: string;
    mutationCount: number;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
/**
 * Stage an EmevdMutationPlan via Bridge as a single atomic batch write
 * (the C# writer applies the `mutations` array and re-reads the output).
 * Staging only: bytes are returned for the caller to commit via Patch Engine.
 */
export declare function stageEmevdPlanViaBridge(request: EmevdPlanCommitRequest & {
    stagingRoot: string;
}): Promise<EmevdPlanStageResult>;
/**
 * Build the file_replace PatchIR for Bridge-staged EMEVD bytes.
 * expectedHash precondition prevents committing over a stale source.
 */
export declare function buildEmevdFileReplacePatch(input: {
    workspaceId: string;
    title: string;
    targetUri: string;
    targetPath: string;
    stagedBytes: Buffer;
    expectedHash: string;
}): PatchIR;
export interface EmevdReopenValidatorInput {
    allowedRoots: string[];
    timeoutMs?: number;
}
/**
 * After-commit Bridge reopen validator for EMEVD file_replace commits
 * (EVENT-30C). Reopens the committed resource natively and fails — which makes
 * the WorkspaceTransaction roll the file back to its before-image — when the
 * committed bytes cannot be re-parsed, the semantic roundtrip is not identical,
 * or the committed file bytes diverge from the staged artifact. This is the
 * "Bridge reopen → event/instruction semantic verify → rollback" boundary of
 * the outer-chain write flow.
 */
export declare function createEmevdReopenValidator(input: EmevdReopenValidatorInput): ValidatorContract;
/**
 * Production EMEVD DSL plan commit:
 * Bridge batch staging → file_replace PatchIR → WorkspaceTransaction
 * (stage/validate/commit/backup/re-read/rollback) → Bridge re-read of the
 * committed file for byte-level consistency.
 */
export declare function commitEmevdPlanViaPatchEngine(request: EmevdPlanPatchEngineCommitRequest): Promise<EmevdPlanCommitResult>;
/**
 * Perform the independent post-commit native read and preserve the durable
 * receipt even when that read throws. The reader seam is production-bound to
 * runBridge by the caller and is injectable only for deterministic tests.
 */
export declare function finalizeEmevdPostCommitRead(input: EmevdPostCommitReadInput): Promise<EmevdPlanCommitResult>;
interface EmevdReadEnvelope {
    sourceHash?: string;
    /** "emevd" for raw payload; "dcx" when Bridge unwrapped a .dcx wrapper. */
    sourceFormat?: string;
    /** SHA-256 of the outer container bytes when opened from a .dcx. */
    outerFileHash?: string;
    eventCount?: number;
    instructionCount?: number;
    roundTrip?: {
        semanticIdentical?: boolean;
        byteIdentical?: boolean;
    };
}
export {};
