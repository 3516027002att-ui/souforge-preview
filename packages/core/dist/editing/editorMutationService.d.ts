/**
 * 原生语义 mutation 的统一写链。
 *
 * 为什么要它：FMG / PARAM / PARAM-field / EMEVD / MSB 五条 IPC handler 各自
 * 写了一遍同样的五步（Bridge 暂存 → 读回字节 → Patch Engine 提交 → 需要确认时
 * 取确认并重试 → 成功后刷新投影），共约 540 行，逐字重复的部分占绝大多数。
 * 真实差异只有四处：Bridge 提交函数、暂存文件名前缀、操作标题、成功后要失效
 * 哪个缓存。把这四处做成参数，其余全部收敛。
 *
 * 为什么放在 core 而不是 apps/desktop：写链属于编辑领域逻辑，不属于 Electron
 * 传输层。留在 IPC 里的后果已经能看到——同一处 staging 诊断归一逻辑被复制了
 * 五遍，任何一遍漏改都不会有测试发现。
 *
 * 为什么确认要注入而不是直接调 dialog：core 不能依赖 electron（否则 core 的
 * 单元测试要跑在 Electron 里，node 测试直接失败）。确认是**能力**而非实现，
 * 因此表达成 confirmPort：Electron 侧传原生对话框实现，测试侧传确定性桩。
 *
 * 边界：本服务不自己写文件。所有 Mod 资源写入仍然只经由注入的 commitWrite
 * （生产实现是 saveRawReplace → PatchIR → WorkspaceTransaction），暂存只写
 * 调用方给定的 stagingRoot。本服务不放宽任何 writer 门槛，也不吞异常：
 * 失败一律返回结构化诊断。
 */
import type { ConfirmationReceipt, Diagnostic, EditorPageQuery, IndexedFile, ReadOperationId, WriteOperationId } from '@soulforge/shared';
import type { SaveRawResourceResult } from './saveRawResource.js';
import type { NativeDocumentLocator } from './nativeDocumentLocator.js';
/**
 * 由 Bridge-confirmed locator 派生编辑器读写能力（§14.4 OpenEditorDocumentValue
 * 的 readOperations/writeOperations）。bnd4 容器层的域由 containerRole 裁定；
 * 松散文件按 leafFormatId 裁定；未知组合返回空集合（capability-blocked）。
 */
export declare function mutationCapabilityForLocator(locator: NativeDocumentLocator): {
    readOperations: readonly ReadOperationId[];
    writeOperations: readonly WriteOperationId[];
};
export declare function readOperationForQuery(queryKind: EditorPageQuery['kind']): ReadOperationId;
/** decoder/数据源用：EditorMutation kind 是 WriteOperationId 的子集（同名）。 */
export declare function isWriteOperationEnabled(writeOperations: readonly WriteOperationId[], mutationKind: string): boolean;
/**
 * 确认能力端口。
 *
 * 返回 null 表示用户取消——必须与「确认失败」区分：取消是正常结果，
 * 不能报成写入错误，否则 UI 会把用户主动取消显示成故障。
 */
export interface WriteConfirmationPort {
    requestConfirmation(input: {
        resourceLabel: string;
        sourceUri: string;
        actionLabel: string;
        /** 待写字节的 sha256。确认凭据绑定它，防止确认后内容被替换。 */
        payloadHash: string;
        extraSubjects?: string[];
    }): Promise<ConfirmationReceipt | null>;
}
/** Patch Engine 提交端口。生产实现包装 saveRawReplace。 */
export interface RawReplaceCommitPort {
    commit(input: {
        file: IndexedFile;
        expectedHash: string;
        newContentBase64: string;
        title: string;
        confirmation?: ConfirmationReceipt;
    }): Promise<SaveRawResourceResult>;
}
export interface NativeMutationStagingContext {
    outputPath: string;
    allowedRoots: string[];
    writableRoots: string[];
}
export interface NativeMutationRequest<T extends {
    ok: boolean;
}> {
    file: IndexedFile;
    sourceUri: string;
    expectedHash: string;
    /** 暂存目录前缀与文件名，会被 bridgeStaging 做安全段校验。 */
    stagingPrefix: string;
    stagingFileName: string;
    stagingRoot: string;
    allowedRoots: (stagingRoot: string) => string[];
    /** 真正调用 Bridge 写出 mutation 结果的函数。各格式唯一的实质差异。 */
    stageWrite: (context: NativeMutationStagingContext) => Promise<T>;
    /** 操作日志与备份标题，例如 `FMG mutation upsert 12345`。 */
    title: string;
    /** 确认对话框里显示的动作名，例如「提交 FMG 变更」。 */
    confirmActionLabel: string;
    confirmExtraSubjects?: string[];
}
export type NativeMutationOutcome = {
    status: 'committed';
    result: SaveRawResourceResult;
    payloadHash: string;
} | {
    status: 'cancelled';
    sourceUri: string;
} | {
    status: 'failed';
    diagnostics: Diagnostic[];
};
export interface NativeMutationCandidate {
    ok: boolean;
    artifactHandle: string;
    stagingPath: string;
    payloadHash: string;
    sourceVersion: string;
    bytes: Buffer;
    newContentBase64: string;
    writerVerificationInfo?: Record<string, unknown>;
    diagnostics: Diagnostic[];
}
/**
 * 内部候选构建出口：只返回 main-owned artifactHandle、hash、源版本、writer 验证信息；不执行 commit。
 */
export declare function buildNativeMutationCandidate<T extends {
    ok: boolean;
}>(request: NativeMutationRequest<T>): Promise<NativeMutationCandidate>;
/**
 * 执行一次原生语义 mutation 的完整写链。
 *
 * 确认重试只做一次：`requiresConfirmation` 是门槛而非重试信号，循环重试会把
 * 「凭据不被接受」变成无限弹窗。第二次仍要求确认则如实返回该结果。
 *
 * S29：confirm 端口可选 —— 不再接端口的链（如容器 PARAM）即使底层 writer
 * 仍报 requiresConfirmation，也直接返回该结果而不弹「高风险写入」确认。
 */
export declare function applyNativeMutation<T extends {
    ok: boolean;
}>(request: NativeMutationRequest<T>, ports: {
    confirm?: WriteConfirmationPort;
    commit: RawReplaceCommitPort;
}): Promise<NativeMutationOutcome>;
