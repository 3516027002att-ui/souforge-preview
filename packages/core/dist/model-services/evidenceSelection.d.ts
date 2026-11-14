/**
 * Current-snapshot evidence selection and context-window budgeting.
 *
 * This module owns selection only. The raw tool message remains in the rollout;
 * the selected sections are a bounded, disposable dynamic snapshot.
 */
import { utf8CodepointPrefix } from '@soulforge/shared';
import { evidenceKey, evidenceResourceKey, evidenceVersionKey, type EvidenceClaim, type EvidenceIdentity, type EvidenceIdentityInput, type EvidenceRevision, type EvidenceVersion } from './evidenceIdentity.js';
export type { EvidenceClaim, EvidenceIdentity, EvidenceIdentityInput, EvidenceRevision, EvidenceVersion };
export { evidenceKey, evidenceResourceKey, evidenceVersionKey };
export declare const DEFAULT_ACTIVE_EVIDENCE_CAPACITY = 512;
export interface EvidenceConflict {
    key: string;
    resourceKey: string;
    version: EvidenceVersion;
    authority: number;
    handles: string[];
    message: string;
}
export interface EvidenceSelectionOptions {
    readonly maxBytes: number;
    readonly maxEntries: number;
    /** Preferred name; the map is host-owned and never inferred from text. */
    readonly currentVersionByResource?: ReadonlyMap<string, EvidenceVersion | EvidenceRevision>;
    /** Reference-compatible alias for simple revision maps. */
    readonly currentRevisionByResource?: ReadonlyMap<string, EvidenceVersion | EvidenceRevision>;
    readonly requiredClaimKeys?: ReadonlySet<string> | readonly string[];
    readonly activeGoalRefs?: readonly string[];
    readonly revokedReaderSchemas?: ReadonlySet<string>;
    readonly maxActiveClaims?: number;
}
export interface SelectedEvidenceSection {
    readonly handle: string;
    readonly key: string;
    readonly resourceKey: string;
    readonly identity: EvidenceIdentity;
    readonly revision: EvidenceRevision | null;
    readonly version: EvidenceVersion;
    readonly title?: string;
    readonly text: string;
    readonly required: boolean;
    readonly truncated: boolean;
    readonly missingFields?: readonly string[];
    readonly cursor?: string;
}
export interface EvidenceSelectionResult {
    readonly selected: SelectedEvidenceSection[];
    readonly serialized: string;
    readonly actualBytes: number;
    /** Alias that makes the wire-byte/token distinction explicit to callers. */
    readonly actualWireBytes: number;
    readonly estimatedTokens?: number;
    readonly omitted: number;
    readonly omittedKeys: string[];
    readonly missingRequired: string[];
    readonly conflicts: EvidenceConflict[];
    readonly activeClaims: number;
    readonly capacityOmitted: number;
}
export declare class EvidenceSelectionError extends Error {
    readonly code: string;
    readonly details?: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
/**
 * Selects current claims and serializes the final sections under real UTF-8
 * byte and entry limits. `chooseEvidence` is a reference-compatible alias.
 */
export declare function selectEvidence(candidates: readonly EvidenceClaim[], options: EvidenceSelectionOptions): EvidenceSelectionResult;
export declare const chooseEvidence: typeof selectEvidence;
/** Reference-compatible name for the code-point-safe UTF-8 prefix helper. */
export declare const utf8Prefix: typeof utf8CodepointPrefix;
export interface LegacyEvidenceCandidate {
    readonly identity: EvidenceIdentityInput;
    readonly handle: string;
    readonly revision?: EvidenceRevision;
    readonly version?: EvidenceVersion;
    readonly text: string;
    readonly relevance?: number;
    readonly authority?: number;
    readonly sequence?: number;
    readonly required?: boolean;
    readonly title?: string;
}
export type LegacyEvidenceSelectionOptions = EvidenceSelectionOptions & {
    readonly candidates: readonly LegacyEvidenceCandidate[];
};
export type LegacyEvidenceSelectionResult = ({
    ok: true;
} & EvidenceSelectionResult) | {
    ok: false;
    code: string;
    message: string;
};
/** Adapter for the original object-shaped SF-19 reference harness. */
export declare function selectEvidenceCandidates(options: LegacyEvidenceSelectionOptions): LegacyEvidenceSelectionResult;
export interface EvidenceCandidateMergeResult {
    readonly candidates: EvidenceClaim[];
    readonly changed: boolean;
    readonly omitted: number;
}
/** Exact repeats do not grow the active queue; newer observations refresh sequence in place. */
export declare function mergeEvidenceCandidates(existing: readonly EvidenceClaim[], additions: readonly EvidenceClaim[], options?: {
    maxActiveClaims?: number;
    requiredClaimKeys?: ReadonlySet<string> | readonly string[];
}): EvidenceCandidateMergeResult;
