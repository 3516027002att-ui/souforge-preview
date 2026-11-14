function normalize(value) {
    return value.trim().toLocaleLowerCase();
}
function sortCounts(entries) {
    return [...entries]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
function mergeCounts(files, role) {
    const counts = new Map();
    for (const file of files) {
        const entries = role === 'entity'
            ? file.parameterizedInstructionCounts
            : role === 'event'
                ? file.parameterizedEventInstructionCounts
                : file.parameterizedTextInstructionCounts;
        for (const entry of entries ?? []) {
            if (entry.count <= 0)
                continue;
            counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.count);
        }
    }
    return counts;
}
function roleTotal(files, role) {
    return files.reduce((sum, file) => sum + (role === 'entity'
        ? file.parameterizedEntityArgs
        : role === 'event'
            ? file.parameterizedEventArgs
            : file.parameterizedTextArgs), 0);
}
export function assessParameterizedEntityCoverage(input) {
    const role = input.role ?? 'entity';
    const scoped = input.sourceUri === undefined && input.mapId === undefined
        ? input.files
        : input.files.filter((file) => input.sourceUri !== undefined
            ? file.sourceUri === input.sourceUri
            : file.mapId === input.mapId);
    const counts = mergeCounts(scoped, role);
    const totalCount = roleTotal(scoped, role);
    const otherRoles = ['entity', 'event', 'text'].filter((item) => item !== role);
    const otherRoleCount = otherRoles.reduce((sum, item) => sum + roleTotal(scoped, item), 0);
    const instructionName = input.instructionName?.trim();
    const instructionContains = input.instructionContains?.trim();
    let scope;
    let relevant;
    const relevantNames = new Set();
    if (instructionName) {
        scope = 'instruction';
        const wanted = normalize(instructionName);
        relevant = sortCounts([...counts].filter(([name]) => normalize(name) === wanted));
    }
    else if (instructionContains) {
        scope = 'instruction-contains';
        const wanted = normalize(instructionContains);
        relevant = sortCounts([...counts].filter(([name]) => normalize(name).includes(wanted)));
    }
    else {
        scope = 'any';
        relevant = sortCounts(counts);
    }
    for (const entry of relevant)
        relevantNames.add(entry.name.toLocaleLowerCase());
    const unrelated = sortCounts([...counts].filter(([name]) => !relevantNames.has(name.toLocaleLowerCase())));
    const relevantCount = relevant.reduce((sum, entry) => sum + entry.count, 0);
    return {
        role,
        scope,
        relevantInstructions: relevant,
        relevantCount,
        totalCount,
        unrelatedInstructions: unrelated,
        otherRoleCount,
        filesInScope: scoped.length,
        filesUnread: scoped.filter((file) => !file.readOk).length,
        blocksNegative: relevantCount > 0
    };
}
//# sourceMappingURL=parameterizedEntityCoverage.js.map