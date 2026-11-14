/**
 * Workspace-backed AI Evidence Pack builder (core only, no UI).
 */
import type { EvidencePack } from '@soulforge/shared';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { SemanticWorkspaceIndex } from '../workspace/semanticWorkspaceIndex.js';
export type EvidencePackScope = 'current_resource' | 'direct_references' | 'reverse_references' | 'diagnostics' | 'provenance' | 'confidence' | 'patch_history' | 'supported_operations' | 'write_risk' | 'unsupported_warnings';
export interface BuiltEvidencePack extends EvidencePack {
    resourceUri: string;
    nativeFormatAuthority: false;
    supportedOperations: string[];
    writeRisk: string;
    candidateRefCount: number;
    confirmedRefCount: number;
    patchHistoryOpIds: string[];
    scope: EvidencePackScope[];
    autoCommitAllowed: boolean;
}
export declare function buildEvidencePack(input: {
    workspaceId: string;
    resourceUri: string;
    index: SemanticWorkspaceIndex;
    operationLog?: OperationLogStore;
    scope?: EvidencePackScope[];
    absolutePath?: string;
    relativePath?: string;
}): Promise<BuiltEvidencePack>;
