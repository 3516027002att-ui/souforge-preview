import { asRecord, asString, fail, finalizeCommittedToolResult } from '../toolRegistrySupport.js';
import { rollbackOperation } from '../../patch/rollback.js';
import { projectOperationReceipt, restoredFileUris } from '../operationReceipt.js';
import { sha256File } from '../../validators/textHash.js';
/** rollback_operation: one domain tool declaration, schema and handler. */
export function createRollbackOperationTool() {
    return {
        name: 'rollback_operation',
        description: 'Rollback a committed operation from its backup. Requires full-permission mode and a host-issued confirmation bound to the operation. For CLI, the user must start the host with --confirm-rollback <opId>; tool input cannot grant its own confirmation. '
            + 'A cross-table mutate_param_fields receipt lists one operation per changed table in data.opIds (and transaction.opIds in a session frame); roll those back one opId at a time in reverse commit order, because a later operation on the same container must be undone first.',
        permission: 'rollback',
        permissionLevel: 'rollback',
        inputSchema: { opId: 'string' },
        run: async (input, context) => {
            const value = asRecord(input);
            const opId = asString(value.opId);
            if (!opId)
                return fail('INVALID_INPUT', 'rollback_operation 需要 opId（list_operations 返回的操作 id），并需在启动时提供 --confirm-rollback <opId>。');
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            // 回滚必须走生产上下文：session（可写路径权威校验）、持久 store（幂等与
            // 审计）、备份/恢复目录（逆向事务的还原点）。缺任一即干净失败，绝不回退
            // 到内存 store —— 那会把「没有备份」伪装成「已回滚」。
            if (!context.session || !context.operationLogStore || !context.backupBaseDir || !context.recoveryDir) {
                return fail('ROLLBACK_CONTEXT_REQUIRED', '回滚需要主进程注入的生产上下文（session / operationLogStore / backupBaseDir / recoveryDir）。');
            }
            const result = await rollbackOperation({
                opId,
                store: context.operationLogStore,
                session: context.session,
                backupBaseDir: context.backupBaseDir,
                recoveryDir: context.recoveryDir,
                author: 'ai',
                ...(context.confirmation ? { confirmation: context.confirmation } : {})
            });
            // rollbackOperation 返回自带 ok 字段的结果对象，不能再用 ok() 整体包装
            // —— 那会把失败状态（EDIT_CONFIRMATION_REQUIRED 等）吞成 ToolResult.ok=true。
            if (!result.ok) {
                const diagnostic = result.diagnostics[0];
                // A single mutate_param_fields call commits one operation per table on the same file,
                // so rolling the first one back first always fails here with no clue that a later
                // operation on the same file is the reason. Name those operations.
                if (diagnostic?.code === 'ROLLBACK_TARGET_CHANGED') {
                    const laterOpIds = await laterOpsOnSameTargets(context.operationLogStore, opId);
                    if (laterOpIds.length > 0) {
                        return fail('ROLLBACK_TARGET_CHANGED', '该操作的目标文件在它之后又被同一个文件的更晚操作改过，所以不能先回滚它。'
                            + '请按时间倒序先回滚这些更晚的操作：' + laterOpIds.join(', ') + '，然后再回滚 ' + opId + '。', { opId, laterOpIds });
                    }
                }
                return fail(diagnostic?.code ?? 'ROLLBACK_FAILED', diagnostic?.message ?? '回滚失败。', { opId: result.opId });
            }
            // 回执只暴露逻辑标识：restoredFiles 的绝对路径与嵌套 record 的 backup/target
            // 路径留在本地审计日志，不进入模型上下文或可公开的会话轨迹。
            const receiptRecord = result.record ? projectOperationReceipt(result.record) : undefined;
            const receipt = {
                ...result,
                restoredFiles: restoredFileUris(result.record, result.restoredFiles),
                ...(receiptRecord ? { record: receiptRecord } : {})
            };
            return finalizeCommittedToolResult({
                data: receipt,
                changedSources: result.restoredFiles,
                context,
                // A rollback used to report nativeVerification=not_performed unconditionally, so the only
                // evidence that the restored bytes were the recorded before-image came from outside the
                // tool. Re-read the restored files and compare against the recorded beforeHash.
                verifyNative: () => verifyRestoredNativeBytes(result, receiptRecord?.files ?? [])
            });
        }
    };
}
/**
 * Post-rollback native readback: hash every restored file and compare it with the hash the rollback
 * operation recorded as its result state (`afterHash` of the inverse operation; the pre-rollback
 * state is its `beforeHash`). A mismatch means the restored bytes are not the recorded restored
 * state, which must surface as state=verification_failed instead of a plain committed rollback.
 */
async function verifyRestoredNativeBytes(result, logicalFiles) {
    if (!result.record || result.restoredFiles.length === 0) {
        return {
            ok: false,
            code: 'ROLLBACK_READBACK_UNAVAILABLE',
            message: '回滚已提交，但没有可用于回读比对的原始操作记录或还原文件列表。'
        };
    }
    const byPath = new Map(result.record.files.map((file) => [file.targetPath, file]));
    const verifiedFiles = [];
    const mismatches = [];
    for (const path of result.restoredFiles) {
        const file = byPath.get(path);
        if (!file)
            continue;
        const index = result.record.files.indexOf(file);
        const targetUri = logicalFiles[index]?.targetUri ?? file.targetUri;
        const actualHash = await sha256File(path).then((hash) => hash.toLowerCase()).catch(() => undefined);
        if (actualHash !== undefined && actualHash === file.afterHash.toLowerCase()) {
            verifiedFiles.push({ targetUri, expectedHash: file.afterHash, actualHash });
        }
        else {
            mismatches.push({ targetUri, expectedHash: file.afterHash, actualHash: actualHash ?? null });
        }
    }
    if (verifiedFiles.length === 0 && mismatches.length === 0) {
        return {
            ok: false,
            code: 'ROLLBACK_READBACK_UNAVAILABLE',
            message: '回滚记录里没有与 restoredFiles 对应的文件身份，无法做原生回读比对。'
        };
    }
    if (mismatches.length > 0) {
        return {
            ok: false,
            code: 'ROLLBACK_READBACK_MISMATCH',
            message: '回滚后原生字节与操作记录的前像哈希不一致；不要把它当成已恢复，先查日志再决定是否重试。',
            details: { method: 'sha256-readback', verifiedFiles, mismatches }
        };
    }
    return { ok: true, details: { method: 'sha256-readback', verifiedFiles } };
}
async function laterOpsOnSameTargets(store, opId) {
    const target = await store.get(opId);
    if (!target)
        return [];
    const targets = new Set(target.files.map((item) => item.targetUri));
    const targetTime = Date.parse(target.committedAt ?? target.createdAt);
    const all = await store.list(target.workspaceId);
    return all
        .filter((item) => item.opId !== opId && item.status === 'committed')
        .filter((item) => Date.parse(item.committedAt ?? item.createdAt) > targetTime)
        .filter((item) => item.files.some((file) => targets.has(file.targetUri)))
        .sort((left, right) => Date.parse(right.committedAt ?? right.createdAt) - Date.parse(left.committedAt ?? left.createdAt))
        .map((item) => item.opId);
}
//# sourceMappingURL=rollback_operation.js.map