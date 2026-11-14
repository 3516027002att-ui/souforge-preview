/**
 * Canonical MapDocument, SceneGraph, EditTransaction, and Blender Adapter boundaries.
 *
 * This module defines the renderer-independent, authoritative semantic representation
 * of Sekiro MSB maps, ensuring human UI, Agent tools, and external 3D tools (Blender)
 * share a single transaction and object identity model.
 */
import { type MapRegionShape } from './msb-shape-profile.js';
export type MapEntityKind = 'model' | 'part' | 'region' | 'event' | 'route';
export type MapEntityFamily = MapEntityKind;
export interface MapNativeIdentity {
    family: MapEntityFamily;
    nativeOffset: number;
    expectedName?: string | undefined;
}
export interface Transform3D {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
}
export interface MapRegionTransform {
    position: [number, number, number];
    rotation: [number, number, number];
}
export interface BaseMapEntity {
    id: string;
    stableKey: string;
    address: string;
    mapId: string;
    name: string;
    kind: MapEntityKind;
    family: MapEntityFamily;
    typeId: number;
    nativeOffset: number;
    internalEntryId?: number | undefined;
    entityId?: number | undefined;
}
export interface MapModelEntity extends BaseMapEntity {
    kind: 'model';
    sibPath?: string | undefined;
    instanceCount?: number | undefined;
}
export interface MapPartEntity extends BaseMapEntity {
    kind: 'part';
    modelIndex: number;
    modelName: string;
    transform: Transform3D;
    drawGroups?: number[] | undefined;
    displayGroups?: number[] | undefined;
    /** Enemy/DummyEnemy 的原生 MSBS NPCParamID → NpcParam 行 ID；其它 part 不出现。 */
    npcParamRowId?: number | undefined;
}
export interface MapRegionEntity extends BaseMapEntity {
    kind: 'region';
    transform: MapRegionTransform;
    shapeType: number;
    shapeData?: MapRegionShape | undefined;
    shape?: number | undefined;
}
export interface MapEventEntity extends BaseMapEntity {
    kind: 'event';
    eventId?: number | undefined;
    referencedPartName?: string | undefined;
    referencedRegionName?: string | undefined;
    referencedEntityId?: number | undefined;
}
export interface MapRouteEntity extends BaseMapEntity {
    kind: 'route';
    routeId?: number | undefined;
    unk08?: number | undefined;
    unk0C?: number | undefined;
}
export type MapEntity = MapModelEntity | MapPartEntity | MapRegionEntity | MapEventEntity | MapRouteEntity;
export type MapEntityResolution = {
    ok: true;
    entity: MapEntity;
} | {
    ok: false;
    code: 'MAP_ENTITY_NOT_FOUND' | 'MAP_ENTITY_AMBIGUOUS';
    candidates: MapEntity[];
};
export interface MapDocument {
    sourceUri: string;
    sourcePath: string;
    mapId: string;
    game: string;
    revision: string;
    readerSchemaRevision?: number | undefined;
    entityIdVerified?: boolean | undefined;
    referenceCoverage?: {
        complete: boolean;
        [key: string]: any;
    } | undefined;
    models: MapModelEntity[];
    parts: MapPartEntity[];
    regions: MapRegionEntity[];
    events: MapEventEntity[];
    routes: MapRouteEntity[];
    totalEntityCount: number;
}
/**
 * 宿主管理的内部快照租约，封装 MapDocument 与 MapSceneGraph，
 * 携带源文件身份与版本指纹，防止模型 JSON 伪造并消除重复加载。
 */
export interface MapSnapshotLease {
    readonly leaseId: string;
    readonly doc: MapDocument;
    readonly sceneGraph: MapSceneGraph;
    readonly sourceIdentity: string;
    readonly sourceVersion: string;
    readonly sourceFileHash?: string | undefined;
    readonly workspaceEpoch?: number | undefined;
    released: boolean;
    release(): void;
}
export declare function createMapSnapshotLease(doc: MapDocument, sceneGraph: MapSceneGraph, sourceIdentity: string, sourceVersion: string, workspaceEpoch?: number | undefined, sourceFileHash?: string | undefined): MapSnapshotLease;
export declare function isValidSnapshotLease(lease: any): lease is MapSnapshotLease;
/**
 * High-performance In-Memory Map SceneGraph for queries, navigation, and cross-references.
 */
export declare class MapSceneGraph {
    private readonly document;
    private readonly entityById;
    private readonly entityByStableKey;
    private readonly entityByAddress;
    private readonly entityByNativeIdentity;
    private readonly entityByName;
    private readonly partsByName;
    private readonly regionsByName;
    private readonly modelsByName;
    private readonly eventsByName;
    private readonly entityByEntityId;
    private readonly partsByModelName;
    private readonly eventsByReferencedRegion;
    private readonly eventsByReferencedPart;
    constructor(document: MapDocument);
    private buildIndices;
    private addIndex;
    private resolveIndex;
    getDocument(): MapDocument;
    /**
     * Resolves exact identities first; a display-name alias is never silently overwritten.
     *
     * `<mapId>#<name>@0x<offset>` / `<name>@0x<offset>` names one physical entity even when the
     * name is shared (MSB allows duplicate part names). The old `<mapId>#<name>` form keeps
     * working for unique names; for a shared name it now answers MAP_ENTITY_AMBIGUOUS with the
     * candidates instead of resolving to whichever entity happened to be indexed first.
     */
    resolveEntity(identifier: string): MapEntityResolution;
    resolveNativeIdentity(identity: MapNativeIdentity): MapEntityResolution;
    findEntity(identifier: string): MapEntity | undefined;
    findPart(identifier: string): MapPartEntity | undefined;
    findRegion(identifier: string): MapRegionEntity | undefined;
    findModel(identifier: string): MapModelEntity | undefined;
    findEvent(identifier: string): MapEventEntity | undefined;
    queryPartsByModel(modelName: string): MapPartEntity[];
    queryByEntityId(entityId: number): MapEntity[];
    queryEventsReferencingRegion(regionName: string): MapEventEntity[];
    queryEventsReferencingPart(partName: string): MapEventEntity[];
    queryParts(predicate?: (part: MapPartEntity) => boolean): MapPartEntity[];
    queryRegions(predicate?: (region: MapRegionEntity) => boolean): MapRegionEntity[];
    queryModels(predicate?: (model: MapModelEntity) => boolean): MapModelEntity[];
}
/**
 * Structured Map Edit Operations
 */
export type MapEditOperation = {
    kind: 'set_transform';
    target: string;
    position?: [number, number, number] | undefined;
    rotation?: [number, number, number] | undefined;
    scale?: [number, number, number] | undefined;
} | {
    kind: 'batch_transform';
    targets: string[];
    positionDelta?: [number, number, number] | undefined;
    rotationDelta?: [number, number, number] | undefined;
    scaleDelta?: [number, number, number] | undefined;
} | {
    kind: 'set_property';
    target: string;
    property: 'entityId' | string;
    value: number | string | boolean;
} | {
    kind: 'change_model';
    target: string;
    newModelName: string;
} | {
    kind: 'delete';
    target: string;
    certificate?: {
        complete: boolean;
        gameProfile?: string | undefined;
        readerSchemaHash?: string | undefined;
        sourceHash?: string | undefined;
        [key: string]: any;
    } | undefined;
} | {
    kind: 'set_region_shape';
    target: string;
    shape: MapRegionShape;
};
export interface MapEditTransaction {
    id: string;
    mapId: string;
    baseRevision: string;
    description: string;
    author: 'human' | 'agent' | 'blender';
    operations: MapEditOperation[];
    timestamp: number;
}
export interface MapTransactionValidationResult {
    valid: boolean;
    diagnostics: Array<{
        severity: 'error' | 'warning';
        code: string;
        message: string;
        target?: string | undefined;
    }>;
}
/**
 * Validates a MapEditTransaction against a target MapDocument.
 */
export declare function validateMapTransaction(doc: MapDocument, transaction: MapEditTransaction): MapTransactionValidationResult;
/**
 * Blender Adapter Contract / DTOs
 */
export interface BlenderObjectDto {
    stableKey: string;
    soulAddress: string;
    entityKind: MapEntityKind;
    family: MapEntityFamily;
    nativeOffset: number;
    name: string;
    modelName?: string | undefined;
    transform: Transform3D | MapRegionTransform;
}
export interface BlenderSceneExport {
    schemaVersion: 1;
    mapId: string;
    revision: string;
    exportedAt: string;
    objects: BlenderObjectDto[];
}
/**
 * A Blender-side mutation. The union admits four actions, but only `modify` is importable today:
 * create, duplicate and delete exist for future writers and are rejected by the importer with
 * BLENDER_IMPORT_ACTION_UNSUPPORTED. Do not read the type as an offer of four working operations.
 */
export interface BlenderMutationDto {
    stableKey: string;
    action: 'modify' | 'duplicate' | 'delete' | 'create';
    family?: MapEntityFamily | undefined;
    nativeOffset?: number | undefined;
    name?: string | undefined;
    modelName?: string | undefined;
    position?: [number, number, number] | undefined;
    rotation?: [number, number, number] | undefined;
    scale?: [number, number, number] | undefined;
}
export interface BlenderDeltaImport {
    schemaVersion: 1;
    mapId: string;
    baseRevision: string;
    importedAt: string;
    mutations: BlenderMutationDto[];
}
/**
 * Exports canonical MapDocument into Blender-compatible Scene Descriptor.
 */
export declare function exportMapSceneForBlender(doc: MapDocument): BlenderSceneExport;
/**
 * Translates Blender delta modifications back into a canonical MapEditTransaction.
 */
export declare function importBlenderDeltaToTransaction(doc: MapDocument, delta: BlenderDeltaImport): {
    ok: true;
    transaction: MapEditTransaction;
} | {
    ok: false;
    error: string;
    conflict?: boolean;
};
/**
 * Builds a canonical MapDocument from raw Bridge parse data without any truncation cap.
 */
export declare function buildCanonicalMapDocument(input: {
    sourceUri: string;
    sourcePath: string;
    game: string;
    revision: string;
    readerSchemaRevision?: number | undefined;
    entityIdVerified?: boolean | undefined;
    models?: Array<{
        name: string;
        nativeOffset?: number | undefined;
        typeId?: number | undefined;
    }> | undefined;
    parts: Array<{
        name: string;
        nativeOffset?: number | undefined;
        typeId: number;
        modelIndex?: number | undefined;
        posX: number;
        posY: number;
        posZ: number;
        rotX?: number | undefined;
        rotY?: number | undefined;
        rotZ?: number | undefined;
        scaleX?: number | undefined;
        scaleY?: number | undefined;
        scaleZ?: number | undefined;
        internalEntryId?: number | undefined;
        entityId?: number | undefined;
        npcParamRowId?: number | undefined;
    }>;
    regions?: Array<{
        name: string;
        nativeOffset?: number | undefined;
        typeId: number;
        shapeType?: number | undefined;
        shapeData?: MapRegionShape | undefined;
        posX: number;
        posY: number;
        posZ: number;
        rotX?: number | undefined;
        rotY?: number | undefined;
        rotZ?: number | undefined;
        scaleX?: number | undefined;
        scaleY?: number | undefined;
        scaleZ?: number | undefined;
        internalEntryId?: number | undefined;
        entityId?: number | undefined;
    }> | undefined;
    events?: Array<{
        name: string;
        nativeOffset?: number | undefined;
        typeId: number;
        eventId?: number | undefined;
    }> | undefined;
    routes?: Array<{
        name: string;
        nativeOffset?: number | undefined;
        typeId: number;
        id?: number | undefined;
    }> | undefined;
}): MapDocument;
