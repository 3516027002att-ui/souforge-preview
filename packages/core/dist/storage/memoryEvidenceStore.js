export class MemoryEvidenceStore {
    workspaces = new Map();
    filesByWorkspace = new Map();
    symbolsByWorkspace = new Map();
    referencesByWorkspace = new Map();
    upsertWorkspace(workspace) {
        this.workspaces.set(workspace.workspaceId, workspace);
    }
    getWorkspace(workspaceId) {
        return this.workspaces.get(workspaceId);
    }
    replaceFiles(workspaceId, files) {
        this.filesByWorkspace.set(workspaceId, [...files]);
    }
    getFiles(workspaceId) {
        return [...(this.filesByWorkspace.get(workspaceId) ?? [])];
    }
    searchFiles(workspaceId, options) {
        const query = normalizeSearch(options.query);
        const limit = options.limit ?? 100;
        const kinds = options.kinds ? new Set(options.kinds) : null;
        const results = [];
        for (const file of this.filesByWorkspace.get(workspaceId) ?? []) {
            if (kinds && !kinds.has(file.resourceKind))
                continue;
            const text = [file.relativePath, file.resourceKind, file.extension].join(' ');
            const score = scoreText(text, query);
            if (score > 0)
                results.push({ item: file, score, highlights: makeHighlights(text, query) });
        }
        return results.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    replaceSymbols(workspaceId, symbols) {
        this.symbolsByWorkspace.set(workspaceId, {
            events: [...(symbols.events ?? [])],
            maps: [...(symbols.maps ?? [])],
            params: [...(symbols.params ?? [])],
            msgs: [...(symbols.msgs ?? [])]
        });
    }
    getSymbols(workspaceId) {
        const symbols = this.symbolsByWorkspace.get(workspaceId);
        return {
            events: [...(symbols?.events ?? [])],
            maps: [...(symbols?.maps ?? [])],
            params: [...(symbols?.params ?? [])],
            msgs: [...(symbols?.msgs ?? [])]
        };
    }
    replaceReferences(workspaceId, references) {
        this.referencesByWorkspace.set(workspaceId, [...references]);
    }
    findReferences(workspaceId, uri, direction = 'both') {
        return (this.referencesByWorkspace.get(workspaceId) ?? []).filter((edge) => {
            if (direction === 'from')
                return edge.fromUri === uri;
            if (direction === 'to')
                return edge.toUri === uri;
            return edge.fromUri === uri || edge.toUri === uri;
        });
    }
}
function normalizeSearch(value) {
    return value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replaceAll(':', ' ')
        .replaceAll('/', ' ')
        .replaceAll('\\', ' ')
        .replaceAll('.', ' ')
        .replaceAll('-', ' ')
        .split(' ')
        .filter(Boolean)
        .join(' ');
}
function scoreText(text, query) {
    if (query.length === 0)
        return 1;
    const normalized = normalizeSearch(text);
    let score = 0;
    for (const term of query.split(' ').filter(Boolean)) {
        if (normalized === term)
            score += 100;
        else if (normalized.startsWith(term))
            score += 40;
        else if (normalized.includes(term))
            score += 12;
    }
    return score;
}
function makeHighlights(text, query) {
    if (query.length === 0)
        return [];
    const normalized = normalizeSearch(text);
    return query.split(' ').filter((term) => term.length > 0 && normalized.includes(term));
}
//# sourceMappingURL=memoryEvidenceStore.js.map