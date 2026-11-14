/**
 * Renderer-independent MSB semantic scene and render packet contracts.
 * This module is browser-safe and must never receive absolute filesystem paths.
 */
export type MsbSceneEntityKind = 'msb-model' | 'msb-part' | 'msb-region' | 'msb-event' | 'msb-route';
export type SceneProxyPrimitive = 'box' | 'sphere' | 'point';
export interface SceneProjectionDiagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
}
export interface SceneResourceMetadata {
    sourceUri: string;
    /** Workspace-relative POSIX path. Never an absolute filesystem path. */
    sourcePath: string;
    game: string;
    resourceKind: 'map';
    revision: string;
}
export interface MsbNativeEntityLike {
    name: string;
    /** Native record offset, used only as a stable opaque identity. */
    nativeOffset?: number;
    typeId?: number;
}
export interface MsbModelLike extends MsbNativeEntityLike {
    sibPath?: string;
}
export interface MsbPartTransformLike extends MsbNativeEntityLike {
    posX: number;
    posY: number;
    posZ: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    /** 指向 models[] 下标；用来找 part 对应的 FLVER。 */
    modelIndex?: number;
}
export interface MsbRegionLike extends MsbNativeEntityLike {
    typeId: number;
    posX: number;
    posY: number;
    posZ: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
}
export interface MsbMapEventLike extends MsbNativeEntityLike {
    typeId: number;
}
export interface MsbRouteLike extends MsbNativeEntityLike {
    typeId: number;
    /** MSB route record id；可能由原生记录缺省。 */
    id?: number;
}
export interface MsbSceneSourceCounts {
    models: number;
    parts: number;
    regions: number;
    events: number;
    routes: number;
}
export interface MsbSemanticSceneEntity {
    id: string;
    label: string;
    kind: MsbSceneEntityKind;
    sourceResourceUri: string;
    nativeOffset?: number;
    typeId?: number;
    /** 仅 msb-route 有效，保留 Bridge 的原生 route id。 */
    routeId?: number;
}
export interface SceneNode extends MsbSemanticSceneEntity {
    kind: 'msb-part' | 'msb-region';
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    /** 指向 manifest.models 的下标；仅 msb-part 有效，用于解析真实 FLVER 的 modelName。 */
    modelIndex?: number;
}
export interface SceneManifest extends SceneResourceMetadata {
    schemaVersion: 2;
    /** Backward-compatible alias for sourceUri. */
    mapResourceUri: string;
    authority: 'partial';
    entityCount: number;
    nodeCount: number;
    entities: MsbSemanticSceneEntity[];
    nodes: SceneNode[];
    /** 模型表，与 SceneNode.modelIndex 联动；用于在 draw 阶段按 modelName 去重拉取 FLVER。 */
    models?: MsbModelLike[];
    sourceCounts: MsbSceneSourceCounts;
    projectedCounts: MsbSceneSourceCounts;
    chunkSize: number;
    diagnostics: SceneProjectionDiagnostic[];
}
export interface SceneDrawItem {
    id: string;
    label: string;
    entityKind: SceneNode['kind'];
    primitive: SceneProxyPrimitive;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    sourceResourceUri: string;
    colorRgb: [number, number, number];
    /** 按 models[modelIndex].name 解析出的 FLVER 名（用于按模型去重的真实网格拉取）；缺省保持线框。 */
    modelName?: string;
    /**
     * S23：该节点对应的真实 FLVER 网格（mapbnd 里按 modelName 提取的 base64
     * typed buffers）。提供时投影层用真实几何替换 proxy 盒子；缺省保持盒子。
     * base64 而不是 typed array：跨 IPC 的语义场景保持可序列化。
     */
    mesh?: {
        positionsBase64: string;
        indicesBase64?: string;
        indexSize?: 16 | 32;
        uvsBase64?: string;
        normalsBase64?: string;
        vertexCount: number;
        /** Bridge 解析出的 albedo PNG data URI；renderer 不猜测本机纹理路径。 */
        texturePreviewToken?: string;
        textureColorSpace?: string;
        /** 合并多个 FLVER mesh 后的 index/vertex draw groups，materialIndex 对应 texturePreviews。 */
        materialGroups?: Array<{
            start: number;
            count: number;
            materialIndex: number;
        }>;
        texturePreviews?: Array<{
            materialIndex: number;
            texturePreviewToken: string;
            colorSpace?: string;
        }>;
        boundingBoxMin?: [number, number, number];
        boundingBoxMax?: [number, number, number];
    };
}
export interface SceneDrawList extends SceneResourceMetadata {
    schemaVersion: 2;
    /** Backward-compatible alias for sourceUri. */
    mapResourceUri: string;
    authority: 'partial';
    packetId: string;
    chunkIndex: number;
    chunkCount: number;
    totalItemCount: number;
    itemCount: number;
    items: SceneDrawItem[];
    bounds: {
        min: [number, number, number];
        max: [number, number, number];
        center: [number, number, number];
    };
    diagnostics: SceneProjectionDiagnostic[];
}
export declare class SceneProjectionError extends Error {
    readonly diagnostic: SceneProjectionDiagnostic;
    constructor(code: string, message: string);
}
export declare function buildMsbSceneManifest(input: SceneResourceMetadata & {
    models?: MsbModelLike[];
    parts: MsbPartTransformLike[];
    regions?: MsbRegionLike[];
    events?: MsbMapEventLike[];
    routes?: MsbRouteLike[];
    sourceCounts?: Partial<MsbSceneSourceCounts>;
    maxNodes?: number;
    chunkSize?: number;
}): SceneManifest;
export declare function chunkSceneNodes(manifest: SceneManifest, chunkIndex: number): SceneNode[];
export declare function buildSceneDrawList(manifest: SceneManifest, options?: {
    chunkIndex?: number;
    maxItems?: number;
}): SceneDrawList;
