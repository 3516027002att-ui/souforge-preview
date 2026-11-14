import { type CoverageState } from '../indexing/coverageState.js';
import type { ChrLinkageResult } from '../references/chrLinkageResolver.js';
import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
export type EntityResolutionDomain = 'event' | 'map' | 'param' | 'msg' | 'action' | 'resource' | 'chr' | string;
export interface NativeEntityHandle {
    namespace: string;
    objectKey: string;
    sourceUri?: string;
    sourceHash?: string;
    sourceRevision?: number | string;
    readerSchemaVersion?: number | string;
    metadataSchemaVersion?: string;
}
export type EntityRelationRequest = string | {
    relation: string;
    targetNamespace?: string;
    ruleId?: string;
};
export interface ResolutionEvidence {
    kind: 'index' | 'native-read' | 'memory' | 'reference-graph' | 'linkage';
    sourceUri?: string | undefined;
    sourceProperty?: string | undefined;
    value?: string | number | boolean | undefined;
    detail: string;
}
export interface EntitySourceSnapshot {
    sourceUri: string;
    sourceHash?: string;
    outerFileHash?: string;
    sourceRevision?: number | string;
    readerSchemaVersion?: number | string;
    metadataSchemaVersion?: string;
}
export interface EntityCandidate {
    candidateId: string;
    namespace: string;
    domain: EntityResolutionDomain;
    nativeHandle: string;
    sourceUri?: string | undefined;
    label?: string | undefined;
    score: number;
    route: 'exact_handle' | 'memory' | 'fmg' | 'param' | 'map' | 'event' | 'resource' | 'reference_graph' | 'native_read';
    status: 'candidate' | 'verified' | 'stale' | 'blocked' | 'excluded';
    nativeVerified: boolean;
    evidence: ResolutionEvidence[];
    sourceSnapshot?: EntitySourceSnapshot | undefined;
    rejectionReason?: string | undefined;
}
export interface IdentityChain {
    candidateId: string;
    nodes: string[];
    verified: boolean;
    links: Array<{
        ruleId: string;
        fromUri: string;
        toUri: string;
        verified: boolean;
    }>;
}
export interface VerifiedRelationEdge {
    ruleId: string;
    fromUri: string;
    toUri: string;
    sourceProperty: string;
    targetNamespace: string;
    sourceSnapshot: EntitySourceSnapshot;
    targetSnapshot?: EntitySourceSnapshot;
    targetConfirmed: boolean;
    confidence: 'high' | 'medium' | 'low';
    evidence: ResolutionEvidence[];
}
export interface PendingRelationEdge {
    fromUri: string;
    toUri: string;
    targetNamespace: string;
    reason: string;
    hypothesis: boolean;
    sourceProperty?: string;
    ruleId?: string;
    evidence: ResolutionEvidence[];
}
export interface ResolverReadPlanStep {
    stepId: string;
    route: 'read_memory' | 'search_fmg' | 'search_param' | 'read_native' | 'read_reference_metadata' | 'read_native_target';
    target: string;
    reason: string;
    priority: number;
    requiredForMutation: boolean;
}
export interface ResolverProgress {
    step: number;
    route: string;
    progressed: boolean;
    progressKind: 'candidate_excluded' | 'native_field_filled' | 'relation_verified' | 'coverage_improved' | 'postcondition' | 'none';
    detail: string;
}
export interface NativeReadRequest {
    handle: string;
    namespace: string;
    objectKey: string;
    domain: EntityResolutionDomain;
    sourceUri?: string;
    requiredFields: string[];
    route: 'exact_handle' | 'candidate' | 'target';
}
export interface NativeReadObservation {
    ok: boolean;
    verified?: boolean;
    candidate?: Partial<Pick<EntityCandidate, 'candidateId' | 'namespace' | 'domain' | 'nativeHandle' | 'sourceUri' | 'label'>>;
    sourceSnapshot?: EntitySourceSnapshot;
    evidence?: ResolutionEvidence[];
    reason?: string;
}
export interface EntityResolutionInput {
    index?: WorkspaceIndex;
    workspaceIndex?: WorkspaceIndex;
    query?: string;
    handle?: string | NativeEntityHandle;
    nativeHandle?: string | NativeEntityHandle;
    domain?: EntityResolutionDomain;
    requiredRelations?: readonly EntityRelationRequest[];
    memoryHints?: readonly string[];
    nativeRead?: (request: NativeReadRequest) => Promise<NativeReadObservation>;
    linkageResolver?: (rowId: number) => Promise<ChrLinkageResult | null>;
    maxDepth?: number;
    maxCandidates?: number;
    maxEdges?: number;
    maxSteps?: number;
    maxRouteChanges?: number;
}
export interface EntityResolutionResult {
    status: 'resolved' | 'ambiguous' | 'partial' | 'blocked' | 'not_found' | 'not_found_complete_coverage';
    query: string;
    domain: EntityResolutionDomain;
    candidates: EntityCandidate[];
    candidateSet: EntityCandidate[];
    identityChains: IdentityChain[];
    verifiedEdges: VerifiedRelationEdge[];
    pendingEdges: PendingRelationEdge[];
    /** Alias retained for callers that call the verified graph simply edges. */
    edges: VerifiedRelationEdge[];
    coverage: CoverageState;
    coverageByDomain: CoverageState[];
    blockedReasons: string[];
    nextReadPlan: ResolverReadPlanStep[];
    attemptedRoutes: string[];
    progress: ResolverProgress[];
    hypotheses: PendingRelationEdge[];
    /** Only current, native-verified candidates may enter this list. */
    mutationTargets: string[];
    /** False when the fuzzy candidate budget truncated distinct target identities. */
    candidateSetComplete: boolean;
    diagnostics: string[];
}
/**
 * Resolve a user name or native handle using only indexed/native evidence.
 * This module never owns a game-specific ID dictionary and never emits a
 * mutation target from a fuzzy or stale observation.
 */
export declare function resolveEntity(input: EntityResolutionInput): Promise<EntityResolutionResult>;
/** Class form for hosts that prefer an explicit resolver object. */
export declare class EntityResolver {
    resolve(input: EntityResolutionInput): Promise<EntityResolutionResult>;
}
export declare const resolveEntityResolution: typeof resolveEntity;
