import { fail, ok } from '../toolRegistrySupport.js';
import { dryRunPatchProposal } from '../../patch/patchEngine.js';
import { normalizeProposalTargets } from '../patchProposalTargets.js';
/** validate_patch: one domain tool declaration, schema and handler. */
export function createValidatePatchTool() {
    return {
        name: 'validate_patch',
        description: 'Run Patch Engine validation in staging on a full PatchProposal. It does not save files.',
        permission: 'validate',
        permissionLevel: 'validate',
        // The whole input *is* the PatchProposal, so every required proposal field
        // must be declared. Declaring only `changes` told the model the rest was
        // unnecessary: dryRunPatchProposal then returned ok:true at the tool layer
        // with an inner PATCH_IR_MISSING_WORKSPACE failure, which the agent loop
        // reads as a successful call.
        inputSchema: {
            opId: 'string',
            workspaceId: 'string',
            changes: 'array',
            title: 'string?',
            author: 'string?',
            mode: 'string?',
            createdAt: 'string?'
        },
        run: async (input) => {
            const proposal = input;
            if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.changes)) {
                return fail('INVALID_INPUT', 'validate_patch 需要 PatchProposal 对象（至少包含 changes 数组）。');
            }
            // The Patch Engine dry run stages file changes. A tool-shaped change has no file edit to
            // stage, so it fell through to TEXT_EDIT_INVALID ("requires structuredEdit.newText"), which
            // describes a symptom instead of the situation. Say what is actually true.
            const nestedTools = proposal.changes
                .map((change) => change.tool)
                .filter((tool) => typeof tool === 'string');
            if (nestedTools.length > 0) {
                return fail('VALIDATE_REQUIRES_FILE_CHANGES', `提案包含 ${nestedTools.length} 条工具形态的 change（${[...new Set(nestedTools)].join(', ')}）：`
                    + 'Patch Engine 预演只能校验文件级变更，这类 change 由写入闸门在执行域工具时校验。'
                    + '要预演请只提交文件级 change，或直接调用域工具。');
            }
            const normalized = normalizeProposalTargets(proposal);
            if (!normalized.ok)
                return fail('PATCH_GRAPH_CHANGE_UNRESOLVED', normalized.message);
            const dryRun = await dryRunPatchProposal(normalized.proposal);
            // A dry run can succeed for a proposal commit_patch will refuse: a text change has no domain
            // identity, so the commit path answers NATIVE_READ_REQUIREMENT_UNAVAILABLE. Reporting only
            // "ok" here sends the caller into a refusal it could have known about.
            const toolShaped = proposal.changes.some((change) => typeof change.tool === 'string');
            const textShaped = proposal.changes.some((change) => change.kind === 'text');
            return ok({
                ...dryRun,
                ...(textShaped && !toolShaped
                    ? {
                        committable: false,
                        commitBlockedBy: ['agent-approval-required', 'text-change-has-no-domain-identity'],
                        note: '预演通过，但文本提案无法从 agent/CLI 提交（缺少域身份与审批通道）。要真正写入请改用对应域工具。'
                    }
                    : { committable: true })
            });
        }
    };
}
//# sourceMappingURL=validate_patch.js.map