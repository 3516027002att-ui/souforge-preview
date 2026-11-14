/**
 * Sekiro MTD（.mtd / .matbin，MaTerial Definition）只读材质文档 wire 类型与三页投影。
 *
 * 与 Bridge 的 read-mtd-document 一一对应（MATERIAL-53A）。布局权威在 C# 侧
 * MtdNativeDocument.cs；这里的类型只描述 wire 形状，不维护第二套 native parser。
 *
 * 语义：
 *  - MTD 在 Sekiro 是 XML 文本材质定义；本卡只做安全 XML 结构投影（无 writer、
 *    无字节重建）。MTD schema 必须从真实字节建立、禁止推断（infer-mtd-schema
 *    永久禁令，scope.json SCOPE-ASSET-MTD），因此 authority 上限是 candidate——
 *    发现未识别 XML 元素/属性时 C# 侧登记 unparsedGaps 并降 partial，上层不得把
 *    「读出来了」伪装成「完整解析」。
 *  - `formatId` 保持 'mtd'；MATERIAL-53D 的 MATBIN read 复用同一 DTO，
 *    用 formatId: 'matbin' 区分（本卡不建 MATBIN parser，catalog 里留 Files）。
 *  - unknown property（param 的未识别属性）由 C# 原样保留在
 *    MaterialPropertyWire.unknown 里，同时进 unparsedGaps；可见但不可编辑。
 *
 * `projectMaterialDocumentPages` 是纯函数，消费方用它把单个 envelope 投影成
 * material / properties / textureReferences 三页，不做任何 I/O。
 */
/** 把 read-mtd-document envelope 投影成三页。纯函数，不吞异常、不做 I/O。 */
export function projectMaterialDocumentPages(doc) {
    return {
        material: {
            format: doc.format,
            formatId: doc.formatId,
            rootElement: doc.rootElement ?? null,
            name: doc.name ?? null,
            version: doc.version ?? null,
            header: doc.header ?? null,
            shaderPath: doc.shaderPath ?? null,
            materialCount: doc.materialCount,
            authority: doc.authority,
        },
        properties: {
            properties: doc.properties ?? [],
            propertiesTruncated: doc.propertiesTruncated,
            authority: doc.authority,
        },
        textureReferences: {
            textureRefs: doc.textureRefs ?? [],
            textureRefsTruncated: doc.textureRefsTruncated,
            authority: doc.authority,
        },
    };
}
/** 窄守卫：判读一个 read-mtd-document 响应是不是 MtdDocument。 */
export function isMtdDocument(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.format === 'MTD-XML'
        && (v.formatId === 'mtd' || v.formatId === 'matbin')
        && typeof v.sourceHash === 'string'
        && typeof v.authority === 'string';
}
//# sourceMappingURL=material-editor.js.map