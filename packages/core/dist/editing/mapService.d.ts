/**
 * Map Service: High-level operations on MapDocument, SceneGraph, and MapEditTransactions.
 *
 * Exposes unified query, inspect, batch transform, and transaction execution
 * for Agent tools, Desktop IPC, and future Blender bridges.
 */
import { MapSceneGraph, type MapSnapshotLease, type MapDocument, type MapEditTransaction, type MapEntity, type MapEntityKind } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
export interface MapQueryResult {
    ok: boolean;
    mapId: string;
    totalEntities: number;
    matchedEntities: MapEntity[];
    /** Native snapshot identity; required before treating a query as write evidence. */
    sourceUri?: string;
    sourceHash?: string;
    error?: {
        code: string;
        message: string;
        candidates?: MapEntityCandidate[];
    };
}
/**
 * 一个候选实体的最小身份集：地址 + 原生偏移。供歧义答复列出候选，
 * 让调用方能直接粘一个唯一地址重试，而不是收到一句「有歧义」却没有出口。
 */
export interface MapEntityCandidate {
    address: string;
    name: string;
    family: MapEntityKind;
    kind: MapSemanticKind;
    nativeOffset: number;
    typeId: number;
    entityId?: number;
}
export declare function mapEntityCandidates(entities: readonly MapEntity[]): MapEntityCandidate[];
/**
 * Two vocabularies name the same map object. The scene graph calls a Part a `part` (its structural
 * family, which is what a write addresses); the index and the search tools call the same object a
 * `character`/`object`/`collision`/`asset`/`mapPiece` by its native part type. Keeping only one of
 * them in a response made the same entity answer `kind=character` in one tool and `kind=part` in
 * another. Every map tool now publishes both: `kind` (semantic, from typeId) and `family`
 * (structural). Queries accept either word.
 */
export type MapSemanticKind = 'character' | 'object' | 'asset' | 'collision' | 'mapPiece' | 'unknown' | 'model' | 'region' | 'event' | 'route';
/** Native MSB part typeId → semantic map object kind (mirrors index ingestion). */
export declare function mapPartKindFromTypeId(typeId: number | undefined): MapSemanticKind;
/** Semantic kind of any scene entity; non-parts report their structural family. */
export declare function semanticMapKind(entity: MapEntity): MapSemanticKind;
export declare const MAP_STRUCTURAL_KINDS: readonly ["model", "part", "region", "event", "route"];
export declare const MAP_PART_SEMANTIC_KINDS: readonly ["character", "object", "asset", "collision", "mapPiece", "unknown"];
export declare function isMapPartSemanticKind(value: string): boolean;
/** Projection shared by every map read tool: semantic `kind` plus structural `family`. */
export declare function projectMapEntityKind(entity: MapEntity): Record<string, unknown>;
/**
 * Normalize one entity identifier to what MapSceneGraph resolves. Returns an explicit mismatch for a
 * handle that names another map, because "not found" for a valid handle of a different map sends the
 * caller looking for a missing entity instead of a wrong file.
 */
export declare function normalizeMapEntityIdentifier(identifier: string, mapId: string): {
    ok: true;
    identifier: string;
} | {
    ok: false;
    code: 'MAP_ENTITY_MAP_MISMATCH';
    message: string;
};
export interface MapInspectResult {
    ok: boolean;
    mapId: string;
    entity?: MapEntity;
    /** Native snapshot identity; required before treating an inspection as write evidence. */
    sourceUri?: string;
    sourceHash?: string;
    references?: {
        referencingEvents?: MapEntity[];
        partsUsingSameModel?: MapEntity[];
    };
    error?: {
        code: string;
        message: string;
        candidates?: MapEntityCandidate[];
    };
}
export interface MapBatchTransformResult {
    ok: boolean;
    mapId: string;
    modifiedCount: number;
    requestedCount?: number;
    resolvedCount?: number;
    effectiveCount?: number;
    noop?: boolean;
    targets: string[];
    before: Array<{
        name: string;
        posX: number;
        posY: number;
        posZ: number;
    }>;
    after: Array<{
        name: string;
        posX: number;
        posY: number;
        posZ: number;
    }>;
    error?: {
        code: string;
        message: string;
        candidates?: MapEntityCandidate[];
    };
}
export interface MapTransactionResult {
    ok: boolean;
    transactionId: string;
    appliedOperations: number;
    revision?: string;
    committed: boolean;
    verification?: 'passed' | 'failed' | 'not_run';
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
    verifiedPostState?: {
        sourceVersion: string;
        touchedEntities: MapEntity[];
        sceneGraph?: MapSceneGraph;
        doc?: MapDocument;
    };
}
/**
 * Loads a full MapDocument from disk via Bridge without truncation.
 */
export declare function loadMapDocument(edit: NativeEditSession, file: string): Promise<{
    ok: true;
    doc: MapDocument;
    sceneGraph: MapSceneGraph;
    filePath: string;
    lease: MapSnapshotLease;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}>;
/**
 * Queries map entities by modelName, entityId, kind, or name substring.
 */
export declare function queryMapEntities(edit: NativeEditSession, file: string, query: {
    modelName?: string;
    entityId?: number;
    kind?: 'model' | 'part' | 'region' | 'event' | 'route';
    nameContains?: string;
    regionName?: string;
}, snapshot?: MapSnapshotLease): Promise<MapQueryResult>;
/**
 * Inspects a specific map entity and discovers its cross-references.
 */
export declare function inspectMapEntity(edit: NativeEditSession, file: string, identifier: string): Promise<MapInspectResult>;
/**
 * Performs a batch transform on multiple map parts (e.g. move all m000320 parts by 3m on X).
 */
export declare function batchTransformMapParts(edit: NativeEditSession, file: string, input: {
    targets: string[];
    deltaX?: number;
    deltaY?: number;
    deltaZ?: number;
    rotDeltaX?: number;
    rotDeltaY?: number;
    rotDeltaZ?: number;
    scaleMultiplier?: number;
}, snapshot?: MapSnapshotLease): Promise<MapBatchTransformResult>;
/**
 * Executes a full MapEditTransaction through validation, simulation, staging, Patch Engine commit, and authoritative reread verification.
 */
export declare function executeMapTransaction(edit: NativeEditSession, file: string, transaction: MapEditTransaction, snapshot?: MapSnapshotLease): Promise<MapTransactionResult>;
