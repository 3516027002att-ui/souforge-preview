/**
 * MSB Bridge read helper for desktop scene / workbench (renderer-safe DTOs only).
 *
 * 三层截断移除后，默认返回 Bridge 完整实体表（models/parts/regions/events/routes）。
 * maxParts/maxRegions/maxModels/maxEvents 仅在调用方显式传入时作为有界窗口
 * （scaleAccess=bounded-window），默认不截断。
 */
export interface MsbBridgePart {
    name: string;
    nativeOffset?: number;
    typeId: number;
    modelIndex?: number;
    posX: number;
    posY: number;
    posZ: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    internalEntryId?: number;
    entityId?: number;
    entityGroupId?: number;
    npcParamRowId?: number;
    model?: string;
}
export interface MsbBridgeRegion {
    name: string;
    nativeOffset?: number;
    typeId: number;
    shapeType?: number;
    posX: number;
    posY: number;
    posZ: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    internalEntryId?: number;
    entityId?: number;
}
export interface MsbBridgeModel {
    name: string;
    nativeOffset?: number;
    typeId: number;
}
export interface MsbBridgeEvent {
    name: string;
    nativeOffset?: number;
    typeId: number;
    eventId?: number;
}
export interface MsbBridgeRoute {
    name: string;
    nativeOffset?: number;
    typeId: number;
    id?: number;
}
export interface MsbBridgeDocument {
    sourceHash: string;
    version: number;
    modelCount: number;
    partCount: number;
    regionCount: number;
    eventCount: number;
    routeCount: number;
    models: MsbBridgeModel[];
    parts: MsbBridgePart[];
    regions: MsbBridgeRegion[];
    events: MsbBridgeEvent[];
    routes: MsbBridgeRoute[];
    authority?: string;
    readerSchemaRevision?: number;
    entityEdit?: string;
}
export declare function readMsbDocumentViaBridge(input: {
    sourcePath: string;
    allowedRoots: string[];
    timeoutMs?: number;
    maxParts?: number;
    maxRegions?: number;
    maxModels?: number;
    maxEvents?: number;
    /** Existing bounded native/client timing schemas; silent unless explicitly true. */
    diagnosticTimings?: boolean;
    workspaceSessionId?: string;
    /** P5 裁定：真实游戏 .msb.dcx 是 KRAK 压缩，缺 Oodle 运行时解不出实体表。 */
    oodleRuntimeRoot?: string;
}): Promise<{
    ok: boolean;
    data?: MsbBridgeDocument;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
        details?: unknown;
    }>;
}>;
