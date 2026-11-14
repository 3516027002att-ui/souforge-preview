interface MeshArrays {
    positions: Float32Array;
    normals: Float32Array | null;
    uvs: Float32Array | null;
    indices: Uint16Array | Uint32Array | null;
    indicesType: 'u16' | 'u32';
    vertexCount: number;
}
/**
 * 将 FLVER 资源导出为 GLB 文件。返回导出统计；失败时抛出带诊断的错误。
 */
export declare function exportFlverToGlb(sourceUri: string, filePath: string, allowedRoots: string[], writableRoots: string[], options?: {
    timeoutMs?: number;
}): Promise<{
    meshCount: number;
    exportedMeshes: number;
    byteLength: number;
}>;
/** 将网格数组组装为 GLB 二进制。 */
export declare function buildGlb(meshes: MeshArrays[]): Uint8Array;
export {};
