/**
 * Sekiro FLVER2（.flver / .flver.dcx）只读模型文档 wire 类型与三页投影。
 *
 * 与 Bridge 的 read-flver-document / read-flver-mesh / read-flver-skeleton /
 * read-flver-texture-slots / read-flver-dummies 一一对应（MODEL-51A）。
 * 布局权威在 C# 侧 FlverNativeDocument.cs；这里的类型只描述 wire 形状，
 * 不维护第二套 native parser。
 *
 * 语义：unknown layout 由 authority 表达——unparsedGaps/layoutWarnings 非空时
 * authority 为 partial，上层不得把「读出来了」伪装成「完整解析」。
 * `projectFlverDocumentPages` 是纯函数，消费方用它把单个 envelope 投影成
 * mesh / material-slot / bounds 三页，不做任何 I/O。
 */
/** 把 read-flver-document envelope 投影成三页。纯函数，不吞异常、不做 I/O。 */
export function projectFlverDocumentPages(doc) {
    const min = doc.boundingBox?.min
        ? [doc.boundingBox.min[0] ?? 0, doc.boundingBox.min[1] ?? 0, doc.boundingBox.min[2] ?? 0]
        : [0, 0, 0];
    const max = doc.boundingBox?.max
        ? [doc.boundingBox.max[0] ?? 0, doc.boundingBox.max[1] ?? 0, doc.boundingBox.max[2] ?? 0]
        : [0, 0, 0];
    return {
        bounds: {
            min,
            max,
            extent: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        },
        meshes: {
            meshCount: doc.meshCount,
            meshes: doc.meshes ?? [],
            meshesTruncated: doc.meshesTruncated,
        },
        materialSlots: {
            textureCount: doc.textureCount,
            textures: doc.textureSlots ?? [],
            texturesTruncated: doc.texturesTruncated,
            materials: doc.materials ?? [],
        },
    };
}
/** 窄守卫：判读一个 read-flver-document 响应是不是 FlverDocument。 */
export function isFlverDocument(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.format === 'FLVER' && typeof v.sourceHash === 'string' && typeof v.authority === 'string';
}
//# sourceMappingURL=flver-editor.js.map