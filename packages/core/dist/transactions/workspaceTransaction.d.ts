/**
 * WorkspaceTransaction scaffold:
 * create -> add PatchIR -> stage -> validate -> commit -> audit -> rollback
 *
 * Only operates on sandbox / temp workspace paths passed in by callers.
 * Never writes outside the provided workspace root.
 */
import type { AuditActor, AuditLogStore, PatchIR, PatchIrOperation, StructuredDiagnostic, ValidatorContract, WriterAdapterContract } from '@soulforge/shared';
import { type RestorePoint } from '../backup/restorePoint.js';
export type TransactionStatus = 'open' | 'staged' | 'validated' | 'committed' | 'rolled_back' | 'failed';
export interface WorkspaceTransactionOptions {
    workspaceId: string;
    /** Absolute sandbox workspace root. All commits must stay under this root. */
    workspaceRoot: string;
    actor?: AuditActor;
    auditLog?: AuditLogStore;
    writers?: WriterAdapterContract[];
    validators?: ValidatorContract[];
    stagingBaseDir?: string;
    backupBaseDir?: string;
    /**
     * Invoked immediately after the restore point is created and before any target
     * file is replaced. A durable caller (e.g. the SQLite journal driver) uses this
     * to persist the backup location ahead of the replace loop so that a process
     * termination mid-commit can still roll the transaction back on restart.
     */
    onRestorePointCreated?: (restorePoint: RestorePoint) => Promise<void> | void;
}
export interface TransactionCommitResult {
    ok: boolean;
    transactionId: string;
    committedPaths: string[];
    diagnostics: StructuredDiagnostic[];
    restorePoint?: RestorePoint;
    /** True when one or more target files may still contain committed bytes. */
    recoveryRequired?: boolean;
}
export interface TransactionRollbackResult {
    ok: boolean;
    transactionId: string;
    restoredPaths: string[];
    diagnostics: StructuredDiagnostic[];
}
export declare class WorkspaceTransaction {
    readonly transactionId: string;
    readonly workspaceId: string;
    readonly workspaceRoot: string;
    private status;
    private readonly patches;
    private readonly actor;
    private readonly auditLog;
    private readonly writers;
    private readonly validators;
    private readonly stagingBaseDir?;
    private readonly backupBaseDir?;
    private readonly onRestorePointCreated;
    private staging;
    private stagedPaths;
    private stagedOpTargets;
    private restorePoint;
    private committedPaths;
    private readonly diagnostics;
    private failureRecovery;
    constructor(options: WorkspaceTransactionOptions);
    getStatus(): TransactionStatus;
    getPatches(): readonly PatchIR[];
    getAuditLog(): AuditLogStore;
    getDiagnostics(): readonly StructuredDiagnostic[];
    getFailureRecoveryMetadata(): Record<string, unknown> | undefined;
    /**
     * The planned commit targets (operation, resolved target path, staging path).
     * Exposed so a durable journal driver can persist per-target after-hashes
     * before the replace loop begins.
     */
    /**
     * 把绝对本机路径脱敏成工作区相对路径，供 diagnostics.details 使用。
     *
     * 为什么必须有：诊断会流到调用方（含 renderer）、日志与审计产物里，绝对路径
     * 会把本机目录结构一起带出去。实测抓到的泄漏在提交后验证失败的分支：
     * details.committedPaths[0] 是绝对路径。
     *
     * 此前没被发现，是因为守这条的判据写成
     *   JSON.stringify(diagnostics).includes(root)
     * 而 Windows 上 stringify 把 \ 转义成 \\，字面比较**恒假**——真泄漏也报绿。
     * 判据已改用 testing/assertNoPathLeak.ts 的递归查找。
     *
     * 落在工作区之外的路径只保留 basename：那种情况本身是异常（越界写入尝试），
     * 完整路径对诊断无益，而它恰恰是最不该外泄的那类。
     */
    private redactPath;
    private redactPaths;
    getCommitTargets(): Array<{
        op: PatchIrOperation;
        targetPath: string;
        stagingPath: string;
    }>;
    addPatch(patch: PatchIR): {
        ok: boolean;
        diagnostics: StructuredDiagnostic[];
    };
    stage(): Promise<{
        ok: boolean;
        stagingRoot?: string;
        diagnostics: StructuredDiagnostic[];
    }>;
    validate(): Promise<{
        ok: boolean;
        diagnostics: StructuredDiagnostic[];
    }>;
    commit(): Promise<TransactionCommitResult>;
    discardStaging(): Promise<StructuredDiagnostic[]>;
    rollback(): Promise<TransactionRollbackResult>;
    private collectCommitTargets;
    private auditValidation;
    private auditFailure;
}
export declare function createWorkspaceTransaction(options: WorkspaceTransactionOptions): WorkspaceTransaction;
