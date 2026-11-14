/**
 * Legacy Patch Engine surface.
 *
 * Production commits no longer apply staging files independently.
 * They compile PatchProposal → PatchIR and execute WorkspaceTransaction
 * (see legacyPatchEngineAdapter.ts).
 *
 * createStagingArea remains for dry-run prep / graph attachment compatibility only.
 */
import type { Diagnostic, OperationLogRecord, PatchChange, PatchMode, PatchProposal, ValidationResult } from '@soulforge/shared';
import type { OperationLogStore } from './operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
export interface CreatePatchProposalInput {
    workspaceId: string;
    title: string;
    author: 'user' | 'ai';
    mode: PatchMode;
    changes: PatchChange[];
    attachGraph?: boolean;
}
export interface StagedPatchFile {
    change: PatchChange;
    stagingPath: string;
    beforeHash: string;
    afterHash: string;
}
export interface StagingArea {
    opId: string;
    root: string;
    files: StagedPatchFile[];
    proposal: PatchProposal;
    /**
     * 释放 `root` 下的临时目录。必须由调用方在 finally 中调用。
     *
     * 在补上这个方法之前，createStagingArea 用 mkdtemp 在系统临时目录建
     * `soulforge-<opId>-*`，但没有任何释放入口，于是每次调用泄漏一个目录。
      * 实测：单次 foundation smoke 泄漏 4 个；本机累计 25724 个残留目录。
     *
     * 幂等：重复调用与对已删除目录调用都不报错（force: true）。
     */
    dispose(): Promise<void>;
}
export interface CommitPatchOptions {
    backupRoot?: string;
    operationLog?: OperationLogStore;
    session?: WorkspaceSession;
    /** Explicit sandbox / overlay root for WorkspaceTransaction. */
    workspaceRoot?: string;
    recoveryDir?: string;
}
export interface CommitPatchResult {
    opId: string;
    backupRoot: string;
    changedFiles: string[];
    diagnostics: Diagnostic[];
    operation?: OperationLogRecord;
}
export declare function createPatchProposal(input: CreatePatchProposalInput): PatchProposal;
/**
 * Compatibility staging helper.
 * Does NOT authorize production commit by itself — commitValidatedStagingArea
 * always re-executes through WorkspaceTransaction.
 */
export declare function createStagingArea(proposal: PatchProposal): Promise<StagingArea>;
/**
 * @deprecated Prefer stageAndValidateProposalThroughTransaction.
 * Kept for API compatibility; validates via WorkspaceTransaction when possible.
 */
export declare function validateStagingArea(staging: StagingArea, session?: WorkspaceSession): Promise<ValidationResult>;
export declare function dryRunPatchProposal(proposal: PatchProposal, session?: WorkspaceSession): Promise<ValidationResult>;
/**
 * Production commit entry for legacy StagingArea callers.
 *
 * Does NOT apply staging.files to the overlay directly.
 * Recompiles staging.proposal into PatchIR and commits via WorkspaceTransaction.
 */
export declare function commitValidatedStagingArea(staging: StagingArea, options?: CommitPatchOptions): Promise<CommitPatchResult>;
/**
 * Preferred production entry when the caller already has a PatchProposal.
 */
export declare function commitPatchProposal(proposal: PatchProposal, options?: CommitPatchOptions): Promise<CommitPatchResult>;
