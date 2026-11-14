/**
 * Shared EMEVD corpus-matrix logic for the wave-1 full-corpus typed-mutation
 * matrix smoke (runEmevdCorpusMatrixSmoke) and the multi-corpus extension
 * (runEmevdMultiCorpusMatrixSmoke).
 *
 * Contains the registry-driven sampling, fail-closed verification and commit
 * verification helpers used by both smokes so the behavior stays identical
 * instead of being copy-pasted. Pure / Bridge-agnostic: all filesystem and
 * Bridge access stays in the calling smoke.
 */
import type { EmevdDslCompileRequest, EmevdEditorDocument } from '@soulforge/shared';
import { type EmedfInstructionDef, type EmedfRegistry } from './emedfSchema.js';
import type { EmevdInstructionDistributionEntry } from './emedfCoverage.js';
export interface EmevdEnvelope {
    sourceHash: string;
    eventCount: number;
    instructionCount: number;
    events?: Array<{
        id: number;
        restBehavior: number;
        instructionCount?: number;
    }>;
    instructionsSample?: Array<{
        index: number;
        bank: number;
        id: number;
        argsBase64: string;
    }>;
    instructionDistribution?: EmevdInstructionDistributionEntry[];
    instructionDistributionTruncated?: boolean;
    roundTrip?: {
        semanticIdentical: boolean;
        byteIdentical: boolean;
    };
    authority?: string;
}
export interface FlatInstruction {
    globalIndex: number;
    event: EmevdEditorDocument['events'][number];
    instruction: EmevdEditorDocument['events'][number]['instructions'][number];
}
/** One sampled covered instruction with its planned typed mutation. */
export interface MatrixSample {
    globalIndex: number;
    instructionAnchor: string;
    bank: number;
    id: number;
    argument: string;
    before: number;
    after: number;
    /** Base64 of the args before commit (equal-length replacement proof). */
    argsBase64Before: string;
    /** Raw vararg tail bytes before commit (byte-exact preservation proof). */
    tailBefore?: Buffer;
}
export interface CoveredMutationPlan {
    samples: MatrixSample[];
    skippedInstances: Array<{
        bank: number;
        id: number;
        globalIndex: number;
        code: string;
        message: string;
    }>;
    coveredKindsPresent: Array<{
        bank: number;
        id: number;
        count: number;
        mutableArgCount: number;
    }>;
    coveredKindsAbsent: Array<{
        bank: number;
        id: number;
    }>;
}
export interface EventMutationSpec {
    eventAnchor: string;
    newId: number;
    newRest: number;
}
export interface MultiLengthKindInfo {
    bank: number;
    id: number;
    count: number;
    lengths: number[];
    covered: boolean;
    vararg: boolean;
    allValidVarargMultiples?: boolean;
}
export interface MatrixCommitVerification {
    typedVerified: number;
    opaquePreservedKinds: number;
    opaquePreservedInstances: number;
    opaqueTotalKinds: number;
    opaqueTotalInstances: number;
    opaqueViolations: string[];
    coveredUntouchedPreserved: number;
    coveredUntouchedTotal: number;
}
export declare function assert(condition: unknown, message: string): asserts condition;
export declare function argsBytesEqual(a: string, b: string): boolean;
export declare function argsLengthOf(argsBase64: string): number;
export declare function flipInRange(value: number, min: number, max: number): number;
export declare function numericRangeOf(type: string): [number, number];
export declare function flatInstructions(document: EmevdEditorDocument): FlatInstruction[];
export declare function compileRequestFor(sourceText: string, schemaFingerprint: string, document: EmevdEditorDocument): EmevdDslCompileRequest;
export declare function buildMatrixDslSource(schemaFingerprint: string, resourceUri: string, eventMutation: EventMutationSpec | undefined, samples: MatrixSample[]): string;
export declare function singleInstructionDsl(schemaFingerprint: string, resourceUri: string, anchor: string, argName: string, value: number): string;
/** Prefer a second sample at a different args length so vararg variants are hit. */
export declare function pickSampleIndices(entries: FlatInstruction[], count: number): number[];
export declare function chooseArgName(def: EmedfInstructionDef, sampleIndex: number): string | undefined;
/** Sample 1-2 instances per schema-covered kind present in the corpus and plan typed mutations. */
export declare function planCoveredMutations(registry: EmedfRegistry, document: EmevdEditorDocument): CoveredMutationPlan;
export declare function pickEventMutation(document: EmevdEditorDocument): {
    event: EmevdEditorDocument['events'][number];
    newId: number;
    newRest: number;
};
/**
 * Every unknown kind must fail closed twice: decode (EMEDF_UNKNOWN_INSTRUCTION)
 * and DSL write (EMEVD_DSL_UNKNOWN_INSTRUCTION_READONLY with zero plan ops).
 * When the registry covers every kind in the document, the verification is a
 * no-op that reports zero checked kinds (callers must not require > 0).
 */
export declare function verifyUnknownKindFailClosed(registry: EmedfRegistry, document: EmevdEditorDocument, schemaFingerprint: string): {
    unknownKindsChecked: number;
    readOnlyDiagnostics: number;
    decodeFailCodes: string[];
};
/** Kinds observed at more than one args length; covered vararg kinds are length-signature valid. */
export declare function analyzeMultiLengthKinds(registry: EmedfRegistry, distribution: EmevdInstructionDistributionEntry[]): MultiLengthKindInfo[];
/**
 * Verify a committed matrix against full before/after documents:
 * typed mutations observable, opaque instructions byte-preserved, covered
 * untouched instructions byte-preserved.
 */
export declare function verifyMatrixCommit(registry: EmedfRegistry, beforeDoc: EmevdEditorDocument, afterDoc: EmevdEditorDocument, samples: MatrixSample[]): MatrixCommitVerification;
/** 2000:0 length-signature distinction: 8/12/16/20/24/32 -> 0/1/2/3/4/6 params. */
export declare function verifyVarargLengthSignature(registry: EmedfRegistry): {
    counts: Array<{
        length: number;
        varargCount: number;
    }>;
    invalidLengthRejectedCode: string;
    belowBaseRejectedCode: string;
    fixedMismatchRejectedCode: string;
};
export declare function verifySyntheticSamples(registry: EmedfRegistry, sample: NonNullable<EmevdEnvelope['instructionsSample']>, samples: MatrixSample[]): void;
