/**
 * Multi-evidence confidence model (architecture fork #106).
 */
import type { ProvenanceSourceKind } from './provenance.js';
import type { ReferenceConfidence } from './types.js';
/** Numeric score in [0, 1]. */
export type ConfidenceScore = number;
export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high' | 'confirmed';
export type ConfidenceReasonCode = 'parser_confirmed' | 'schema_confirmed' | 'profile_match' | 'user_confirmed' | 'validator_passed' | 'synthetic_fixture' | 'heuristic' | 'numeric_match' | 'insufficient_evidence' | 'conflicting_evidence' | 'unsupported_format';
export interface ConfidenceReason {
    code: ConfidenceReasonCode;
    message: string;
    weight?: number;
    sourceKind?: ProvenanceSourceKind;
}
export interface ConfidenceAssessment {
    score: ConfidenceScore;
    level: ConfidenceLevel;
    reasons: ConfidenceReason[];
    /** When fused from multiple sources. */
    fusedFrom?: ConfidenceAssessment[];
}
/**
 * Map legacy reference confidence to the richer model.
 */
export declare function referenceConfidenceToLevel(value: ReferenceConfidence): ConfidenceLevel;
export declare function levelToScore(level: ConfidenceLevel): ConfidenceScore;
export declare function scoreToLevel(score: ConfidenceScore): ConfidenceLevel;
export declare function createConfidence(level: ConfidenceLevel, reasons: ConfidenceReason[], score?: ConfidenceScore): ConfidenceAssessment;
/**
 * Simple weighted fusion — scaffold, not a full Bayesian model.
 * Synthetic fixture evidence is capped at medium unless user/validator upgrades it.
 */
export declare function fuseConfidence(parts: ConfidenceAssessment[]): ConfidenceAssessment;
export declare function syntheticFixtureConfidence(message?: string): ConfidenceAssessment;
