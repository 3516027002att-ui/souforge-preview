import type { Diagnostic, ReferenceEdge, SymbolBundle } from '@soulforge/shared';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
export interface ReferenceBuildOptions {
    /**
     * Medium/low confidence numeric matching can create noisy edges.
     * Keep it enabled for exploration, but never label it high confidence.
     */
    enableNumericFallback?: boolean;
    /**
     * If a numeric value matches more targets than this, the builder suppresses low-confidence edges.
     */
    maxAmbiguousNumericMatches?: number;
    /**
     * Name-inference hypotheses are excluded from the graph unless this is true.
     * Even when included they stay low-confidence with an explicit rule name.
     */
    includeHypotheses?: boolean;
    /**
     * Trusted EMEDF registry. When supplied, unknown bank/id instructions are
     * surfaced as diagnostics instead of silently producing no reference.
     */
    registry?: EmedfRegistry;
}
export interface ReferenceBuildResult {
    edges: ReferenceEdge[];
    /**
     * Semantic gaps surfaced by the PARAM/EMEVD reference providers
     * (unresolved conditions, rejected Refs syntax, dangling targets, unknown
     * instructions, cross-file event id candidates). These must never collapse
     * into "no edges" — a missing relation is a finding.
     */
    diagnostics: Diagnostic[];
    stats: {
        high: number;
        medium: number;
        low: number;
        suppressedAmbiguousNumbers: number;
    };
}
export declare function buildReferenceGraph(bundle: SymbolBundle, options?: ReferenceBuildOptions): ReferenceBuildResult;
