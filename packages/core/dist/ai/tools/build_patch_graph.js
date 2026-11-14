import { fail, ok } from '../toolRegistrySupport.js';
import { normalizeProposalTargets } from '../patchProposalTargets.js';
import { buildGraphPatchFromProposal, summarizeGraphPatch } from '../../patch/graphPatch.js';
/** build_patch_graph: one domain tool declaration, schema and handler. */
export function createBuildPatchGraphTool() {
    return {
        name: 'build_patch_graph',
        description: 'Project a full PatchProposal into the graph patch IR for review.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        // Same whole-input-is-the-proposal contract as validate_patch. With only
        // `changes` declared, a proposal missing opId produced ok:true carrying
        // node id "op:undefined" and summary "op=undefined files=1" — polluted
        // output with no error anywhere in the chain.
        inputSchema: {
            opId: 'string',
            workspaceId: 'string',
            changes: 'array',
            title: 'string?',
            author: 'string?',
            mode: 'string?',
            createdAt: 'string?'
        },
        run: (input, context) => {
            const proposal = input;
            if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.changes)) {
                return fail('INVALID_INPUT', 'build_patch_graph 需要 PatchProposal 对象（至少包含 changes 数组）。');
            }
            const normalized = normalizeProposalTargets(proposal);
            if (!normalized.ok)
                return fail('PATCH_GRAPH_CHANGE_UNRESOLVED', normalized.message);
            const graph = buildGraphPatchFromProposal(normalized.proposal);
            // A file node for a path the workspace does not hold reads as if the target exists. Mark each
            // file node with whether the index knows it, and name the unknown ones in the answer.
            const index = context.workspaceIndex;
            const missingFiles = [];
            if (index !== null && index !== undefined && typeof index.getFile === 'function') {
                const nodes = graph.nodes ?? [];
                for (const node of nodes) {
                    if (node.kind !== 'file' || typeof node.uri !== 'string')
                        continue;
                    const exists = index.getFile(node.uri) !== undefined;
                    node.meta = { ...(node.meta ?? {}), exists };
                    if (!exists)
                        missingFiles.push(node.uri);
                }
            }
            return ok({
                graph,
                summaryText: summarizeGraphPatch(graph),
                ...(missingFiles.length > 0
                    ? {
                        missingFiles,
                        note: `提案里 ${missingFiles.length} 个目标文件不在当前索引中：${missingFiles.slice(0, 3).join('、')}。`
                            + '先确认路径，或在写入前用对应的读取工具打开该文件。'
                    }
                    : {})
            });
        }
    };
}
//# sourceMappingURL=build_patch_graph.js.map