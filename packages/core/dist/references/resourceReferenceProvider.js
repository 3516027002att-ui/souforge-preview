export function resolveFmgTextIdentity(input) {
    if (!Number.isSafeInteger(input.textId))
        throw new Error('FMG_TEXT_ID_REQUIRED');
    if (input.category.length === 0)
        throw new Error('FMG_CATEGORY_REQUIRED');
    const segments = [input.sourceUri, ...input.childChain, input.category, input.language ?? ''];
    for (const segment of segments) {
        if (segment.length === 0 || segment.includes('|'))
            throw new Error('FMG_IDENTITY_SEGMENT_INVALID');
    }
    return `${input.sourceUri}|${input.childChain.join('/')}|${input.category}|${input.language ?? ''}|${input.textId}`;
}
export function buildTaeSemanticEdges(input) {
    // 未解码参数体不产生已确认语义边。
    if (!input.decoded)
        return { edges: [], diagnostics: [`undecoded-tae:${input.taeEntryIndex}:${input.animId}`] };
    return {
        edges: input.fields.map((field) => ({
            from: `${input.sourceUri}#tae${input.taeEntryIndex}:anim${input.animId}`,
            to: `tae-field:${field.name}=${String(field.value)}`,
            relationKind: 'references_motion',
            certainty: 'confirmed'
        })),
        diagnostics: []
    };
}
export function buildContainerMembershipEdge(input) {
    if (input.childChain.length === 0)
        throw new Error('CONTAINER_CHILD_CHAIN_REQUIRED');
    for (const segment of input.childChain) {
        if (segment.length === 0 || segment.includes('|') || segment.includes('#')) {
            throw new Error('CONTAINER_CHILD_SEGMENT_INVALID');
        }
    }
    return { from: input.outerSourceUri, to: `${input.outerSourceUri}#${input.childChain.join('/')}`, relationKind: 'member' };
}
//# sourceMappingURL=resourceReferenceProvider.js.map