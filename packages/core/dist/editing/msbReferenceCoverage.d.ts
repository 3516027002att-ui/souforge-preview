/**
 * MSB Reference Coverage and Structural Deletion Planner.
 *
 * Implements SF-04 / T05 / T06:
 * - MsbReferenceDescriptor: specifies ownership, property, storage, index domain, target value, sentinel, and deletion policy.
 * - ReferenceCoverageCertificate: cryptographic and schema assurance that all entity types and reference domains in the document have been exhaustively parsed and understood.
 * - remapReferences: O(N+E) reference remapping algorithm. Ensures no dangling references remain.
 * - evaluateStructuralDeletion: evaluates whether target handles can be safely removed without breaking referential integrity or external connections.
 */
export interface MsbReferenceDescriptor {
    ownerHandle: string;
    ownerProperty: string;
    targetIndexDomain: 'parts_all' | 'parts_subtype' | 'regions_all' | 'events_all' | string;
    targetResolutionRule?: string | undefined;
    storageOffset: number;
    storageType: 'int32' | 'int16' | 'int64';
    value: number;
    nullSentinel: number;
    nullable: boolean;
    onDeletePolicy: 'reject' | 'clear';
    sourceSchemaHash: string;
}
export interface ReferenceCoverageCertificate {
    gameProfile: string;
    readerSchemaHash: string;
    sourceHash: string;
    presentTypeIds: number[];
    decodedReferenceKinds: string[];
    unknownReferenceRegions: string[];
    complete: boolean;
}
export interface StructuralDeletionPlan {
    domain: string;
    oldCount: number;
    removedIndices: number[];
    indexMap: number[];
    rewrittenReferences: MsbReferenceDescriptor[];
}
export interface StructuralDeletionResult {
    ok: boolean;
    code?: string | undefined;
    message?: string | undefined;
    plan?: StructuralDeletionPlan | undefined;
    blockedReferences?: Array<{
        owner: string;
        property: string;
        reason: string;
    }> | undefined;
}
/**
 * Computes a ReferenceCoverageCertificate for a given map document.
 * In production native maps, complete is false because unknown reference regions exist.
 * In verified synthetic closed fixtures where all reference domains are validated, complete can be certified true.
 */
export declare function computeReferenceCoverageCertificate(doc: {
    mapId?: string | undefined;
    parts?: Array<{
        typeId: number;
    }> | undefined;
    regions?: Array<{
        typeId: number;
        shapeType?: number;
    }> | undefined;
    events?: Array<{
        typeId: number;
    }> | undefined;
}, knownComplete?: boolean): ReferenceCoverageCertificate;
/**
 * Remaps an array of references according to a set of deleted indices.
 * Complies strictly with the O(N+E) reference algorithm from native-layout.mjs.
 */
export declare function remapReferences(oldCount: number, removedIndices: number[], references: MsbReferenceDescriptor[], options?: {
    complete?: boolean;
} | undefined): {
    map: number[];
    rewritten: MsbReferenceDescriptor[];
};
/**
 * Evaluates a structural deletion request.
 */
export declare function evaluateStructuralDeletion(oldCount: number, targetIndices: number[], references: MsbReferenceDescriptor[], options?: {
    certificate?: ReferenceCoverageCertificate | undefined;
    externalReferences?: Map<number, string[]> | undefined;
}): StructuralDeletionResult;
