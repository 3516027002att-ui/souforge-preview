export function normalizeProposalTargets(proposal) {
    const changes = [];
    for (const [index, rawChange] of proposal.changes.entries()) {
        const change = rawChange;
        const args = typeof change.args === 'object' && change.args !== null
            ? change.args
            : {};
        const explicitPath = typeof change.targetPath === 'string' && change.targetPath.trim() !== ''
            ? change.targetPath
            : undefined;
        const targetPath = explicitPath
            ?? [args.file, args.containerPath, args.childPath, args.targetPath]
                .find((value) => typeof value === 'string' && value.trim() !== '');
        const targetUri = typeof change.targetUri === 'string' && change.targetUri.trim() !== ''
            ? change.targetUri
            : targetPath ? `file://${targetPath.replace(/\\/gu, '/')}` : undefined;
        if (!targetUri) {
            return {
                ok: false,
                index,
                message: `第 ${index + 1} 条 change 没有可解析的目标文件（既无 targetUri，嵌套参数里也没有 file/containerPath/childPath）。`
                    + '请给出 targetUri，或在 tool 形态里带上目标路径参数。'
            };
        }
        changes.push({ ...change, targetUri, ...(targetPath ? { targetPath } : {}) });
    }
    return { ok: true, proposal: { ...proposal, changes } };
}
//# sourceMappingURL=patchProposalTargets.js.map