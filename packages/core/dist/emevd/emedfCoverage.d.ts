/**
 * EMEDF schema coverage analysis over a real (or synthetic) instruction
 * distribution emitted by the Bridge `read-emevd-document` envelope.
 *
 * The distribution is aggregate-only (bank/id -> count and args-length
 * histogram), so this analysis never sees instruction payload content.
 * Coverage claims are length-consistency checked: an instruction kind only
 * counts as cleanly covered when the schema-claimed encoded length matches
 * every observed args length in the corpus.
 */
import { type EmedfRegistry, type EmedfInstructionDef } from './emedfSchema.js';
export interface EmevdInstructionDistributionEntry {
    bank: number;
    id: number;
    count: number;
    /** args length (bytes) -> observed frequency. Keys are decimal strings from JSON. */
    argsLengths: Record<string, number>;
}
export interface EmevdCoverageAnalysis {
    totalKinds: number;
    coveredKinds: number;
    /** Kinds whose observed lengths all match the schema-claimed encoded length. */
    cleanKinds: number;
    /** Vararg kinds whose observed lengths are all valid vararg multiples. */
    varargKinds: number;
    coveredInstances: number;
    totalInstances: number;
    /** Instances whose observed length matches the schema-claimed length (or is a valid vararg multiple). */
    cleanInstances: number;
    /** Instances whose observed length does not match the schema-claimed length. */
    mismatchInstances: number;
    /** Instances of kinds with no schema definition. */
    unknownInstances: number;
    kindCoverageRatio: number;
    instanceCoverageRatio: number;
    lengthMismatches: Array<{
        bank: number;
        id: number;
        count: number;
        schemaLength: number;
        observedLengths: number[];
        /** True when the definition has a vararg tail but some observed lengths are invalid. */
        vararg: boolean;
    }>;
    unknownKinds: Array<{
        bank: number;
        id: number;
        count: number;
    }>;
    registryOrigin: EmedfRegistry['origin'];
    truncated: boolean;
}
/**
 * Analyze a distribution against a registry. Never throws on odd corpus data —
 * it reports structural facts (unknown kinds, length mismatches) instead.
 */
export declare function analyzeEmedfCoverage(registry: EmedfRegistry, distribution: EmevdInstructionDistributionEntry[], truncated?: boolean): EmevdCoverageAnalysis;
export interface CorpusDistributionInput {
    label: string;
    distribution: EmevdInstructionDistributionEntry[];
}
export interface CorpusFamilyPresence {
    bank: number;
    id: number;
    /** Total instances across all corpora. */
    totalCount: number;
    /** Per-corpus instance counts (label -> count). */
    counts: Record<string, number>;
    /** Corpora (labels) where this family appears. */
    presentIn: string[];
    /** Corpora (labels) where this family is absent. */
    absentIn: string[];
}
export interface CorpusFamilyDifferenceSummary {
    corpusLabels: string[];
    unionFamilyCount: number;
    /** Instruction families present in every corpus. */
    familiesInAllCorpora: CorpusFamilyPresence[];
    /** Instruction families present in a strict subset (>=1 but not all corpora). */
    familiesInSubset: CorpusFamilyPresence[];
    /** Per-corpus kind/instance totals. */
    perCorpus: Array<{
        label: string;
        kinds: number;
        instances: number;
    }>;
}
/**
 * Compare instruction distributions across multiple corpora and report which
 * instruction families appear only in a subset of them (cross-corpus
 * distribution differences). Pure aggregate analysis: never touches payload
 * content. Deterministic: sorted by bank:id, then totalCount desc.
 */
export declare function summarizeCorpusFamilyDifferences(corpora: CorpusDistributionInput[]): CorpusFamilyDifferenceSummary;
/**
 * Length consistency of a single schema definition against every distribution
 * entry with that bank/id. Returns the schema-claimed length and the observed
 * lengths, or null when the definition never appears.
 */
export declare function schemaLengthVsObserved(def: EmedfInstructionDef, distribution: EmevdInstructionDistributionEntry[]): {
    schemaLength: number;
    observedLengths: number[];
} | null;
