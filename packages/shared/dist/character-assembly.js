export function isAssemblyProvenance(value) {
    if (!value || typeof value !== 'object')
        return false;
    const r = value;
    if (r.kind === 'param-field') {
        return typeof r.paramUri === 'string' && typeof r.table === 'string' && Number.isInteger(r.rowIndex) && typeof r.fieldId === 'string' && typeof r.expectedDataHash === 'string';
    }
    if (r.kind === 'explicit-selection') {
        return typeof r.selectionEventId === 'string' && typeof r.selectedResourceUri === 'string';
    }
    return false;
}
export function isCharacterAssemblyContext(value) {
    if (!value || typeof value !== 'object')
        return false;
    const r = value;
    if (typeof r.leaderModelUri !== 'string' || !isAssemblyProvenance(r.leaderProvenance))
        return false;
    if (!Array.isArray(r.bodyParts) || !Array.isArray(r.attachments))
        return false;
    if (typeof r.workspaceGeneration !== 'number' || !Number.isInteger(r.workspaceGeneration))
        return false;
    for (const part of r.bodyParts) {
        if (!part || typeof part !== 'object')
            return false;
        const p = part;
        if (typeof p.slot !== 'string' || typeof p.resourceUri !== 'string' || !isAssemblyProvenance(p.provenance))
            return false;
    }
    for (const att of r.attachments) {
        if (!att || typeof att !== 'object')
            return false;
        const a = att;
        if (typeof a.resourceUri !== 'string' || typeof a.attachBoneName !== 'string' || !isAssemblyProvenance(a.provenance))
            return false;
    }
    return true;
}
export function isAnimationPlaybackContext(value) {
    if (!value || typeof value !== 'object')
        return false;
    const r = value;
    return typeof r.animationContainerUri === 'string'
        && typeof r.skeletonContainerUri === 'string'
        && typeof r.animationId === 'number' && Number.isInteger(r.animationId)
        && isAssemblyProvenance(r.animationProvenance)
        && isAssemblyProvenance(r.skeletonProvenance)
        && typeof r.workspaceGeneration === 'number' && Number.isInteger(r.workspaceGeneration);
}
//# sourceMappingURL=character-assembly.js.map