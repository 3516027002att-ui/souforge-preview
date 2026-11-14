/**
 * FMG reference-integrity diagnostics (read-only).
 *
 * Scans FMG v2 documents for the `<?tag@id?>` / `<?tag?>` reference grammar
 * observed in the real Sekiro zhocn corpus (menu.msgbnd / item.msgbnd —
 * e.g. `<?placeName@1000?>`, `<?kgiconKc@18?>`, `<?bmsg?>`, `<?null?>`),
 * and reports structured diagnostics:
 *
 *   - duplicate entry ids within one document             -> error
 *   - reference targets outside signed 32-bit range       -> error
 *   - negative reference targets                          -> warning
 *   - reference targets missing from the container-wide
 *     id set                                              -> warning
 *     (the tag may point at an external resource such as a
 *     key-guide icon or gdsparam rather than an FMG entry;
 *     SoulForge does not assert tag semantics — it only reports
 *     container-resolution status, so a miss is a warning, not
 *     a hard error)
 *   - reference targets present in the container id set   -> info
 *   - marker references without an id (`<?bmsg?>`)        -> info
 *
 * This is a read-only integrity pass. It never opens a write path.
 */
export interface FmgReferenceEntry {
    id: number;
    text?: string | null;
}
export interface FmgReferenceDocument {
    index: number;
    name: string;
    entries: FmgReferenceEntry[];
}
export interface FmgReferenceMatch {
    tag: string;
    /** Numeric target when the `@id` form was used. */
    targetId: number | undefined;
    /** Character offset of the reference within the entry text. */
    textIndex: number;
}
export interface FmgReferenceIntegrityDiagnostic {
    severity: 'error' | 'warning' | 'info';
    code: string;
    documentIndex: number;
    documentName: string;
    entryId: number;
    tag?: string;
    targetId?: number;
    textIndex: number;
    message: string;
}
export interface FmgReferenceIntegrityInput {
    documents: FmgReferenceDocument[];
}
export interface FmgReferenceIntegritySummary {
    documentCount: number;
    entryCount: number;
    containerUniqueIdCount: number;
    referenceCount: number;
    withIdReferenceCount: number;
    markerReferenceCount: number;
    resolvedCount: number;
    danglingCount: number;
    invalidCount: number;
    negativeCount: number;
    duplicateIdCount: number;
    /** References counted per tag (sorted). */
    referencesByTag: Record<string, number>;
    truncatedDiagnostics: boolean;
}
export interface FmgReferenceIntegrityResult {
    ok: boolean;
    diagnostics: FmgReferenceIntegrityDiagnostic[];
    summary: FmgReferenceIntegritySummary;
}
/**
 * Extracts all `<?tag...?>` references from a single FMG entry text.
 * Deterministic; never mutates its input.
 */
export declare function extractFmgReferences(text?: string | null): FmgReferenceMatch[];
/**
 * Runs the read-only reference-integrity pass over a set of FMG documents
 * that belong to one container (a single msgbnd). The container-wide entry
 * id set is the resolution domain: a target id that exists anywhere in the
 * container counts as resolved, a missing target is a dangling/possibly
 * external-reference warning.
 */
export declare function analyzeFmgReferenceIntegrity(input: FmgReferenceIntegrityInput): FmgReferenceIntegrityResult;
