/**
 * EMEVD four-view document controller — single revision, selection sync,
 * structured mutations only (no DSL parse pollution of valid mutations).
 */
import type { EmevdDslCompileRequest, EmevdEditorDocument, EmevdEditorMutation, EmevdMutationPlan, EmevdSelection, EmevdViewId } from '@soulforge/shared';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
import { type EmevdPlanCommitResult } from './emevdPlanCommit.js';
export interface EmevdFourViewState {
    document: EmevdEditorDocument;
    selection: EmevdSelection;
    dslText: string;
    tableRows: Array<{
        eventId: number;
        restBehavior: number;
        instructionCount: number;
        eventUri: string;
    }>;
}
export declare function createEmevdEditorDocument(input: {
    resourceUri: string;
    events: Array<{
        eventId: number;
        restBehavior: number;
        layer?: number;
        parameters?: Array<{
            instructionIndex: number;
            targetStartByte: number;
            sourceStartByte: number;
            byteCount: number;
            unkId?: number;
        }>;
        instructions?: Array<{
            bank: number;
            id: number;
            argsBase64?: string;
            unknown?: boolean;
        }>;
    }>;
    bytesBase64?: string;
    documentInstanceId?: string;
    /**
     * 打开路径不要算稳定身份：真实 common 上 attach 要扫 33266 条指令并做大量 SHA-256，
     * 实测约 139 ms 主线程长帧。反汇编 / outline 不需要锚。写链在提交前再 attach。
     */
    attachIdentity?: boolean;
}): EmevdEditorDocument;
export declare function renderEmevdDsl(document: EmevdEditorDocument): string;
export declare function buildFourViewState(document: EmevdEditorDocument, selection: EmevdSelection): EmevdFourViewState;
export declare function selectEmevdView(selection: EmevdSelection, view: EmevdViewId, eventUri?: string, instructionUri?: string): EmevdSelection;
/**
 * Apply a structured mutation. DSL text is never parsed for mutations here —
 * invalid DSL cannot pollute the document.
 */
export declare function applyEmevdEditorMutation(document: EmevdEditorDocument, mutation: EmevdEditorMutation): {
    ok: true;
    document: EmevdEditorDocument;
} | {
    ok: false;
    code: string;
    message: string;
};
/** Parse DSL is intentionally non-authoritative: errors never mutate the document. */
export declare function tryParseEmevdDsl(_text: string): {
    ok: false;
    code: 'EMEVD_DSL_NON_AUTHORITATIVE';
    message: string;
};
/**
 * Apply a compiled DSL plan to the editor document (revision +1).
 * Used after a successful commit so the four-view layer stays in sync.
 * An empty plan returns the document unchanged (nothing consumed).
 */
export declare function applyEmevdPlanToDocument(document: EmevdEditorDocument, plan: EmevdMutationPlan, registry: EmedfRegistry): {
    ok: true;
    document: EmevdEditorDocument;
} | {
    ok: false;
    code: string;
    message: string;
};
export interface EmevdDslPlanSubmitRequest {
    compileRequest: EmevdDslCompileRequest;
    document: EmevdEditorDocument;
    registry: EmedfRegistry;
    /** Absolute path of the EMEVD file on the writable overlay. */
    sourcePath: string;
    /** SHA-256 of the source file bytes (commit precondition). */
    expectedDocumentHash: string;
    /**
     * SHA-256 of the outer source resource bytes (the .dcx wrapper). When the
     * source is a .dcx, the file_replace precondition compares against these.
     */
    expectedOuterFileHash?: string;
    allowedRoots: string[];
    workspaceId: string;
    /** Overlay root; the commit target must stay inside it. */
    workspaceRoot: string;
    /** Root where Bridge staging temp dirs are created. */
    stagingRoot: string;
    oodleRuntimeRoot?: string | undefined;
    targetUri?: string;
    title?: string;
    session?: WorkspaceSession;
    operationLog?: OperationLogStore;
    backupBaseDir?: string;
    recoveryDir?: string;
    timeoutMs?: number;
}
export interface EmevdDslPlanSubmitResult {
    ok: boolean;
    plan?: EmevdMutationPlan;
    nextDocument?: EmevdEditorDocument;
    commit?: EmevdPlanCommitResult;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
}
/**
 * Production DSL submit entry for the four-view editing layer:
 * compile → typed plan → Bridge batch staging → file_replace PatchIR →
 * WorkspaceTransaction (stage/validate/commit/backup/re-read/rollback).
 * Returns the next editor document (revision +1) on success.
 */
export declare function submitEmevdDslPlanViaFourView(input: EmevdDslPlanSubmitRequest): Promise<EmevdDslPlanSubmitResult>;
