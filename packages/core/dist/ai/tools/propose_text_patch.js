import { asOptionalString, asPatchMode, asRecord, asString, fail, nativeFormatHint, ok } from '../toolRegistrySupport.js';
import { createPatchProposal } from '../../patch/patchEngine.js';
/** propose_text_patch: one domain tool declaration, schema and handler. */
export function createProposeTextPatchTool() {
    return {
        name: 'propose_text_patch',
        description: 'Create a text-only patch proposal. It does not save files, and it cannot be committed from the '
            + 'agent/CLI path: a text change has no domain identity, so commit_patch only accepts it through the '
            + 'Agent approval panel. For an agent-driven edit use the domain tool instead '
            + '(mutate_luabnd_script, mutate_fmg_entries, mutate_param_fields, ...).',
        permission: 'propose',
        permissionLevel: 'propose',
        inputSchema: {
            targetUri: 'string?',
            targetPath: 'string?',
            newText: 'string',
            title: 'string?',
            mode: 'enum:plan|normal|fullPermission?'
        },
        run: (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const workspaceId = ws.workspaceId;
            const rawUri = asOptionalString(value.targetUri);
            const rawPath = asOptionalString(value.targetPath);
            // Both identify the same file; requiring both made a caller who supplied one get a schema
            // complaint instead of a proposal. Accept either and derive the other from it.
            const targetUri = rawUri ?? (rawPath ? `file://${rawPath.replaceAll('\\', '/')}` : undefined);
            const targetPath = rawPath ?? (rawUri?.startsWith('file://')
                ? decodeURIComponent(rawUri.slice('file://'.length))
                : undefined);
            const newText = asString(value.newText);
            const title = asString(value.title, 'AI text patch proposal');
            const mode = asPatchMode(value.mode, context.mode);
            if (!targetUri || !targetPath || newText === undefined) {
                return fail('INVALID_INPUT', 'propose_text_patch 需要 targetUri 或 targetPath（二者可从其中一个推出）以及 newText。'
                    + 'targetUri 用 search_text_entries 返回的 textUri；targetPath 用该文件的工作区路径。');
            }
            const nativeHint = nativeFormatHint(targetUri, targetPath);
            if (nativeHint) {
                return fail('USE_NATIVE_EDIT_FACADE', nativeHint);
            }
            const proposal = createPatchProposal({
                workspaceId,
                title,
                author: 'ai',
                mode,
                changes: [
                    {
                        targetUri,
                        targetPath,
                        kind: 'text',
                        structuredEdit: { newText }
                    }
                ]
            });
            return ok({
                ...proposal,
                committable: false,
                commitBlockedBy: ['agent-approval-required', 'text-change-has-no-domain-identity'],
                note: '文本提案只供审阅：agent/CLI 没有审批通道，提交会以 EDIT_CONFIRMATION_REQUIRED / '
                    + 'NATIVE_READ_REQUIREMENT_UNAVAILABLE 结束。需要真正写入请改用对应域工具。'
            });
        }
    };
}
//# sourceMappingURL=propose_text_patch.js.map