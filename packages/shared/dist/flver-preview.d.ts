import type { Diagnostic } from './types.js';
export type FlverRotationOrder = 'XZY';
export type FlverSkinningMode = 'weighted' | 'rigid' | 'static';
/**
 * Generic albedo preview cannot reproduce native projected-decal materials.
 * A compatibility-projected mesh is a separate, explicit read-only path for
 * a verified assembly mapping; it is not a generic fallback for native decal
 * materials.
 */
export type FlverPreviewRenderMode = 'surface' | 'projected-decal' | 'compatibility-projected';
export type FlverPreviewVertexColorStatus = 'absent' | 'decoded' | 'unsupported' | 'truncated' | 'invalid';
export type FlverPreviewVertexColorLayoutName = 'Float4' | 'Color' | 'UByte4Norm';
/** 一个原生 VertexColor member 的完整 RGBA 只读诊断。 */
export interface FlverPreviewVertexColorDiagnostic {
    memberOrdinal: number;
    memberIndex: number;
    /** SoulsFormats LayoutType numeric value: Float4=3, Color=16, UByte4Norm=19. */
    layoutType: number;
    layoutTypeName: FlverPreviewVertexColorLayoutName;
    vertexBufferIndex: number;
    bufferLayoutIndex: number;
    structOffset: number;
    /** Little-endian float[4] RGBA, base64 encoded per vertex. */
    rgbaBase64: string;
}
/** Native tangent/bitangent evidence. No generic material tangent policy is implied. */
export interface FlverPreviewVector4Diagnostic {
    memberOrdinal: number;
    memberIndex: number;
    layoutType: number;
    layoutTypeName: string;
    vertexBufferIndex: number;
    bufferLayoutIndex: number;
    structOffset: number;
    xyzwBase64: string;
}
/** All native position/normal members; diagnostic values do not change the selected shader attributes. */
export interface FlverPreviewVector3Diagnostic {
    memberOrdinal: number;
    memberIndex: number;
    layoutType: number;
    layoutTypeName: string;
    vertexBufferIndex: number;
    bufferLayoutIndex: number;
    structOffset: number;
    xyzBase64: string;
    /** Raw native integer NormalW. Absent for a Float3 normal member. */
    normalWBase64?: string | undefined;
}
export interface FlverContainerEntryIdentity {
    index: number;
    id: number;
    name: string;
    duplicateOrdinal: number;
    contentHash: string;
}
export interface FlverPreviewBone {
    index: number;
    name: string;
    parentIndex: number;
    childIndex: number;
    nextSiblingIndex: number;
    /** Parent-chain identity; duplicate sibling names carry an occurrence ordinal. */
    hierarchyId: string;
    translation: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    /** Native reference FK, serialized in row-major System.Numerics order. */
    referenceFkMatrix?: number[] | undefined;
    rotationOrder: FlverRotationOrder;
}
export interface FlverPreviewMesh {
    meshIndex: number;
    /** FLVER material table index; -1 means the native mesh has no valid material. */
    materialIndex?: number | undefined;
    vertexCount: number;
    indexSize: 16 | 32;
    positionsBase64: string;
    indicesBase64: string;
    uvsBase64?: string | undefined;
    /** 全部原生 UV 组；UVPair/Short4 等一个 member 展开为多组。 */
    uvSetsBase64?: string[] | undefined;
    normalsBase64?: string | undefined;
    /** 所有原生 VertexColor member 的 RGBA，只读诊断；失败时不返回部分结果。 */
    vertexColorStatus?: FlverPreviewVertexColorStatus | undefined;
    vertexColorFailure?: string | undefined;
    vertexColorDiagnostics?: FlverPreviewVertexColorDiagnostic[] | undefined;
    positionStatus?: FlverPreviewVertexColorStatus | undefined;
    positionFailure?: string | undefined;
    positionDiagnostics?: FlverPreviewVector3Diagnostic[] | undefined;
    normalStatus?: FlverPreviewVertexColorStatus | undefined;
    normalFailure?: string | undefined;
    normalDiagnostics?: FlverPreviewVector3Diagnostic[] | undefined;
    tangentStatus?: FlverPreviewVertexColorStatus | undefined;
    tangentFailure?: string | undefined;
    tangentDiagnostics?: FlverPreviewVector4Diagnostic[] | undefined;
    bitangentStatus?: FlverPreviewVertexColorStatus | undefined;
    bitangentFailure?: string | undefined;
    bitangentDiagnostics?: FlverPreviewVector4Diagnostic[] | undefined;
    /** 兼容字段：首个 VertexColor 的 alpha，绝不是全局透明度。 */
    vertexAlphaBase64?: string | undefined;
    /** Selected native FaceSet.CullBackfaces; undefined means no display FaceSet. */
    cullBackfaces?: boolean | undefined;
    /** Explicit compatibility-only projection source; native decal identity stays separate. */
    projectionTextureName?: string | null | undefined;
    projectionTexturePreviewToken?: string | null | undefined;
    projectionTextureColorSpace?: string | null | undefined;
    boneWeightsBase64?: string | undefined;
    boneIndicesBase64?: string | undefined;
    skinningMode: FlverSkinningMode;
    boneIndexSpace: 'flver-global' | 'none';
    /**
     * Native FLVER mesh.Dynamic contract. Dynamic==0 is rendered by mature
     * viewers with absolute reference-pose bone matrices; dynamic meshes use
     * the conventional inverse-bind delta path.
     */
    skinningTransformMode?: 'absolute' | 'delta' | undefined;
    /**
     * Original part-local skin indices retained when a character part is
     * assembled through a follower skeleton. `boneIndicesBase64` remains the
     * leader-space compatibility projection for existing callers, while the
     * renderer uses this source payload with the part's own bind inverses.
     */
    sourceBoneIndicesBase64?: string | undefined;
    skeletonId?: string | undefined;
    renderMode?: FlverPreviewRenderMode | undefined;
}
export interface FlverPreviewModel {
    modelId: string;
    entry: FlverContainerEntryIdentity;
    meshCount: number;
    boneCount: number;
    meshes: FlverPreviewMesh[];
    bones: FlverPreviewBone[];
    /** Original part skeleton retained for follower binding in a read-only character preview. */
    bindingBones?: FlverPreviewBone[] | undefined;
    /** Source FLVER bone index -> leader bone index; -1 means intentionally unmapped/unweighted. */
    bindingBoneMap?: number[] | undefined;
    sourceRole?: 'character' | 'part' | 'map' | 'object' | undefined;
    sourceName?: string | undefined;
    /** Bridge 解析出的首个 albedo PNG data URI，供旧 renderer/调用方回退。 */
    texturePreviewToken?: string | undefined;
    textureColorSpace?: string | undefined;
    /** FLVER material index -> albedo preview. 一个 FLVER 可能同时使用多张纹理。 */
    texturePreviews?: FlverPreviewTexture[] | undefined;
}
export interface FlverPreviewTexture {
    materialIndex: number;
    textureName: string;
    texturePreviewToken: string;
    width: number;
    height: number;
    colorSpace: string;
    /** Native MTD alpha policy. AO/SSS character surfaces may use RGBA as color data, not cutout coverage. */
    alphaMode?: 'opaque' | 'cutout' | undefined;
    /** Native second diffuse/albedo layer, kept separate from the primary map. */
    albedo2?: FlverPreviewTextureLayer | undefined;
    /** Native second normal layer, if the material declares one. */
    normal2?: FlverPreviewTextureLayer | undefined;
    /** Only emitted for a source-mapped native diffuse blend configuration. */
    diffuseBlend?: FlverPreviewDiffuseBlend | undefined;
    /** Exact same-TPF companion maps; these are preview inputs, not native shader equivalence. */
    normalTextureName?: string | undefined;
    normalTexturePreviewToken?: string | undefined;
    normalTextureColorSpace?: string | undefined;
    metalnessTextureName?: string | undefined;
    metalnessTexturePreviewToken?: string | undefined;
    metalnessTextureColorSpace?: string | undefined;
    /** Native MTD Mask1 companion used by a colour-blend operation, never opacity. */
    mask1TextureName?: string | undefined;
    mask1TexturePreviewToken?: string | undefined;
    mask1TextureColorSpace?: string | undefined;
}
export interface FlverPreviewTextureLayer {
    textureName: string;
    texturePreviewToken: string;
    width: number;
    height: number;
    colorSpace: string;
}
export interface FlverPreviewDiffuseBlend {
    mode: 'multiply';
    albedo2UvIndex: number;
    blendMaskUvIndex: number;
    undefinedBlendMaskValue: number;
    enableTextureAlpha: boolean;
    multiplyBlendMaskByAlbedo2Alpha: boolean;
}
/**
 * Atomic preview payload. After explicit CharacterAssemblyContext resolution,
 * the bundle is leader-remapped: exactly one leader skeleton drives the pose.
 * Body parts retain their original bind skeleton metadata and use a follower
 * mapping so their native inverse bind matrices are not discarded. The
 * leader-space skin indices remain as a compatibility projection. Positive-
 * weight missing mapping is fail-closed. Attachments are not body parts — they
 * use explicit attachBoneName.
 */
export interface CharacterPreviewBundle {
    meshCount: number;
    vertexCount: number;
    boneCount: number;
    leaderModelId: string;
    models: FlverPreviewModel[];
    assemblyParts?: string[] | undefined;
    /** A compatibility preview is deterministic, but does not represent save-game equipment. */
    assemblyMode?: 'explicit' | 'compatibility-preview' | undefined;
}
export interface CharacterPreviewReadResult {
    ok: boolean;
    sourceUri?: string | undefined;
    relativePath?: string | undefined;
    data?: CharacterPreviewBundle | undefined;
    diagnostics: Diagnostic[];
}
export declare function isCharacterPreviewBundle(value: unknown): value is CharacterPreviewBundle;
