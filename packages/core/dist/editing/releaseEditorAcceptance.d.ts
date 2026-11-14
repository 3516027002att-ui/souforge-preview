import type { EditorKind, EditorMutationKind } from '@soulforge/shared';
import { type EditorDocumentAuthorityContract, type EditorScaleAccess, type ProposedReleaseEditorId } from './editorCapabilityContract.js';
export type ReleaseEditorEvidenceKind = 'candidate' | 'functional-observation';
export type ReleaseEditorAcceptanceStatus = 'candidate' | 'rejected';
export type ReleaseEditorAcceptanceDiagnosticArea = 'inventory' | 'source' | 'document-authority' | 'revision' | 'typed-mutation' | 'scale-access' | 'release-ruling' | 'functional-acceptance';
export interface ReleaseEditorInventoryItem {
    releaseEditorId: ProposedReleaseEditorId;
    editorKind: Extract<EditorKind, ProposedReleaseEditorId>;
    scopeRulingStatus: 'user-approved';
    releaseIncluded: true;
    documentAuthorityRequirement: EditorDocumentAuthorityContract;
    mutationKinds: EditorMutationKind[];
    revisionContract: 'monotonic-reject-stale';
    scalePrimitives: EditorScaleAccess[];
    currentScaleAccess: EditorScaleAccess;
    scaleDimensions: string[];
    contractSources: string[];
}
export interface EditorFunctionalScaleSchema {
    schemaVersion: 2;
    releaseEditorId: ProposedReleaseEditorId;
    scopeRulingStatus: 'user-approved';
    quantitativeThresholdsRequired: false;
    acceptedAccessModes: Array<'pagination' | 'virtualization' | 'chunking' | 'streaming'>;
    scaleDimensions: string[];
}
export type EditorDocumentAuthorityLevel = 'unsupported' | 'unverified' | 'candidate' | 'fixture-confirmed' | 'partial' | 'native-verified' | 'raw-byte-authority';
export interface EditorScaleSample {
    schemaVersion: 2;
    releaseEditorId: ProposedReleaseEditorId;
    sourceMode: 'real-document' | 'demo-fallback' | 'synthetic';
    documentAuthority: 'none' | EditorDocumentAuthorityContract;
    authorityLevel: EditorDocumentAuthorityLevel;
    revision: string | number | null;
    rejectsStaleRevision: boolean;
    observedMutationKinds: EditorMutationKind[];
    scaleAccess: EditorScaleAccess;
}
export interface ReleaseEditorAcceptanceDiagnostic {
    severity: 'warning' | 'error';
    area: ReleaseEditorAcceptanceDiagnosticArea;
    code: string;
    message: string;
}
export interface ReleaseEditorAcceptanceResult {
    schemaVersion: 2;
    ok: null;
    releaseEditorId: ProposedReleaseEditorId;
    acceptanceStatus: ReleaseEditorAcceptanceStatus;
    evidenceKind: ReleaseEditorEvidenceKind;
    evidenceAuthority: 'candidate';
    releaseGateDecision: 'pending';
    releasePassed: false;
    scopeRulingStatus: 'user-approved';
    quantitativeThresholdsRequired: false;
    functionalAcceptanceStatus: 'pending';
    realFunctionalAcceptanceRun: false;
    diagnostics: ReleaseEditorAcceptanceDiagnostic[];
}
export interface EvaluateReleaseEditorAcceptanceInput {
    sample: EditorScaleSample;
    claimedReleaseDecision?: 'pending' | 'pass';
}
export declare function buildProposedReleaseEditorInventory(): ReleaseEditorInventoryItem[];
/**
 * Defines the non-quantitative editor scale contract. Numeric capacity, latency,
 * package-size, and elapsed-time thresholds are explicitly outside acceptance;
 * every editor must instead expose complete content through a bounded access
 * mode and retain the normal authority/revision/mutation gates.
 */
export declare function buildReleaseEditorFunctionalScaleSchemas(): EditorFunctionalScaleSchema[];
/**
 * Evaluates one functional observation. This contract harness cannot emit a
 * release pass: the later production gate must still run the complete Electron
 * workflow against real native documents. No numeric threshold ruling is
 * required.
 */
export declare function evaluateReleaseEditorAcceptance(input: EvaluateReleaseEditorAcceptanceInput): ReleaseEditorAcceptanceResult;
