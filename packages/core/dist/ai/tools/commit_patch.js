import { fail, finalizeCommittedToolResult, nativeFormatHint } from '../toolRegistrySupport.js';
import { isAbsolute, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { commitPatchProposal } from '../../patch/patchEngine.js';
/** commit_patch: one domain tool declaration, schema and handler. */
export function createCommitPatchTool() {
    return {
        name: 'commit_patch',
        description: 'Commit a PatchProposal through Patch Engine (staging, backup, hash check, rollback metadata). '
            + 'changes must be file changes with a targetPath (the shape propose_text_patch returns); nested tool calls '
            + 'such as { tool, args } are validated by the write gate but NOT executed here — call that domain tool directly. '
            + 'In the Agent panel the user approves the card; from the CLI pass --confirm-patch <opId> (one-shot, bound to this workspace).',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: {
            opId: 'string',
            workspaceId: 'string',
            changes: 'array',
            title: 'string?',
            author: 'string?',
            mode: 'string?',
            createdAt: 'string?'
        },
        run: async (input, context) => {
            const proposal = input;
            if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.changes)) {
                return fail('INVALID_INPUT', 'commit_patch 需要 PatchProposal 对象（至少包含 changes 数组）。');
            }
            if (!context.session || !context.operationLogStore || !context.backupBaseDir) {
                return fail('COMMIT_CONTEXT_REQUIRED', '提交需要主进程注入的生产上下文（session / operationLogStore / backupBaseDir）。');
            }
            if (!context.confirmation?.id || context.confirmation.subjects.length === 0) {
                return fail('EDIT_CONFIRMATION_REQUIRED', '提交需要用户在 Agent 审批卡确认后签发的写入回执。'
                    + 'agent/CLI 路径没有审批卡，因此提案类提交在这里不可用；'
                    + '请直接调用对应域工具（mutate_fmg_entries、mutate_param_fields、mutate_luabnd_script 等）完成写入。');
            }
            const overlayRoot = context.session.layers.overlayRoot;
            const resolvedChanges = [];
            for (const change of proposal.changes) {
                if (typeof change.targetPath !== 'string' || change.targetPath.trim() === '') {
                    const nestedTool = typeof change.tool === 'string'
                        ? change.tool
                        : undefined;
                    return fail('INVALID_INPUT', nestedTool
                        ? `commit_patch 不执行嵌套工具调用（收到 ${nestedTool}）：写入要求已由闸门校验，但执行必须直接调用该域工具。`
                        : 'commit_patch 的每条 change 都需要 targetPath。');
                }
                const absolute = isAbsolute(change.targetPath)
                    ? change.targetPath
                    : join(overlayRoot, change.targetPath);
                // A text change bypasses the domain writers, so keep it away from native formats even
                // when an approval receipt is present: those formats have their own facades and their
                // own readback.
                const nativeHint = nativeFormatHint(String(change.targetUri ?? ''), String(change.targetPath));
                if (nativeHint !== null)
                    return fail('USE_NATIVE_EDIT_FACADE', nativeHint, { targetPath: change.targetPath });
                const writable = context.session.resolveWritablePath(absolute, change.layer ?? 'overlay');
                if (!writable.ok || !writable.absolutePath) {
                    const diagnostic = writable.diagnostics[0];
                    return fail(diagnostic?.code ?? 'WRITE_OUTSIDE_OVERLAY', diagnostic?.message ?? '目标不在当前打开的工作区里，无法写入。', { targetPath: change.targetPath });
                }
                // The Patch Engine writes structuredEdit.newText verbatim, so a target that starts with a
                // UTF-8 BOM would lose it — that changes the file's encoding without anyone asking. Carry
                // the marker across unless the caller already supplied one.
                const edit = change.structuredEdit;
                let structuredEdit = change.structuredEdit;
                if (typeof edit?.newText === 'string' && !edit.newText.startsWith('\uFEFF')) {
                    try {
                        const head = readFileSync(writable.absolutePath).subarray(0, 3);
                        if (head.length === 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf)
                            structuredEdit = { ...edit, newText: `\uFEFF${edit.newText}` };
                    }
                    catch {
                        // A missing target is a new file: nothing to preserve.
                    }
                }
                resolvedChanges.push({ ...change, structuredEdit, targetPath: writable.absolutePath });
            }
            const result = await commitPatchProposal({ ...proposal, changes: resolvedChanges, author: proposal.author === 'user' ? 'user' : 'ai' }, {
                session: context.session,
                operationLog: context.operationLogStore,
                workspaceRoot: overlayRoot,
                backupRoot: context.backupBaseDir,
                ...(context.recoveryDir ? { recoveryDir: context.recoveryDir } : {})
            });
            const failed = result.diagnostics.some((item) => item.severity === 'error')
                || result.changedFiles.length === 0;
            if (failed) {
                const diagnostic = result.diagnostics.find((item) => item.severity === 'error');
                return fail(diagnostic?.code ?? 'COMMIT_FAILED', diagnostic?.message ?? 'Patch Engine 提交失败，工作区未被修改。', { opId: result.opId, diagnostics: result.diagnostics });
            }
            return finalizeCommittedToolResult({ data: result, changedSources: result.changedFiles, context });
        }
    };
}
//# sourceMappingURL=commit_patch.js.map