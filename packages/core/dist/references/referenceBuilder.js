import { REFERENCE_PROVIDERS } from './referenceProviderRegistry.js';
const DEFAULT_MAX_AMBIGUOUS_NUMERIC_MATCHES = 12;
export function buildReferenceGraph(bundle, options = {}) {
    // All providers run through the registry so the graph and the query service
    // build edges from exactly one list (T08). The old inline loop that promoted
    // name inference straight to "high" is deleted (T05 step 12).
    const edges = [];
    const diagnostics = [];
    let suppressedAmbiguousNumbers = 0;
    for (const provider of REFERENCE_PROVIDERS) {
        const shard = provider.build(bundle, {
            ...options,
            maxAmbiguousNumericMatches: options.maxAmbiguousNumericMatches ?? DEFAULT_MAX_AMBIGUOUS_NUMERIC_MATCHES
        });
        for (const edge of shard.edges)
            edges.push(edge);
        for (const diagnostic of shard.diagnostics)
            diagnostics.push(diagnostic);
        suppressedAmbiguousNumbers += shard.suppressedAmbiguousNumbers ?? 0;
    }
    const dedupedEdges = dedupeEdges(edges);
    return {
        edges: dedupedEdges,
        diagnostics,
        stats: {
            high: dedupedEdges.filter((edge) => edge.confidence === 'high').length,
            medium: dedupedEdges.filter((edge) => edge.confidence === 'medium').length,
            low: dedupedEdges.filter((edge) => edge.confidence === 'low').length,
            suppressedAmbiguousNumbers
        }
    };
}
function dedupeEdges(edges) {
    const seen = new Set();
    const output = [];
    for (const edge of edges) {
        const evidenceKey = edge.evidence.map((item) => `${item.instructionUri ?? item.sourceUri}:${String(item.value ?? '')}`).join('|');
        const key = `${edge.fromUri}|${edge.toUri}|${edge.kind}|${edge.confidence}|${evidenceKey}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(edge);
    }
    return output;
}
//# sourceMappingURL=referenceBuilder.js.map