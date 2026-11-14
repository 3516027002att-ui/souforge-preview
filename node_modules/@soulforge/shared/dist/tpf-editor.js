/**
 * Sekiro TPF（.tpf / .tpf.dcx，Texture Package File）只读纹理包文档 wire 类型
 * 与投影（TEXTURE-52A）。与 Bridge 的 read-tpf-document / read-tpf-texture-preview
 * 一一对应。
 *
 * 布局权威在 C# 侧 TpfNativeDocument.cs；这里的类型只描述 wire 形状，
 * 不维护第二套 native parser。
 *
 * 语义：
 *  - authority 只在所有纹理都含合法 DDS 头且宽高>0 时为 native-verified，
 *    否则 partial——上层不得把「读出来了」伪装成「完整解析」。
 *  - texture.format 是 TPF 条目表 formatByte 经 FormatName 查表的结果，
 *    **不是真实像素格式**（真实格式在 DDS 头里，见 ddsFourCC）。消费方展示
 *    格式时必须两者分开，不能把查表结果当像素格式上报。
 *  - rebuildCoverage 表达无修改重建的条件性无损：uncoveredNonZeroBytes>0 时
 *    roundTrip.byteIdentical 必然为 false，那是源文件里未覆盖区非零的事实，
 *    不是解析缺陷。
 *
 * `projectTpfDocumentPages` 是纯函数，消费方用它把单个 envelope 投影成
 * texture list / summary 两页，不做任何 I/O。
 */
/** 把 read-tpf-document envelope 投影成两页。纯函数，不吞异常、不做 I/O。 */
export function projectTpfDocumentPages(doc) {
    return {
        textures: {
            textureCount: doc.textureCount,
            textures: doc.textures ?? [],
            authority: doc.authority,
        },
        summary: {
            sourceSize: doc.sourceSize,
            sourceHash: doc.sourceHash,
            dataLength: doc.dataLength,
            platform: doc.platform,
            encoding: doc.encoding,
            flags: doc.flags,
            roundTrip: doc.roundTrip,
            rebuildCoverage: doc.rebuildCoverage,
            authority: doc.authority,
        },
    };
}
/** 窄守卫：判读一个 read-tpf-document 响应是不是 TpfDocument。 */
export function isTpfDocument(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.format === 'TPF' && typeof v.sourceHash === 'string' && typeof v.authority === 'string';
}
/** 纹理稳定 ID，与 tpf-texture-replace mutation 的 textureStableId 同构。 */
export function tpfTextureStableId(index) {
    return `texture:${index}`;
}
/** 由纹理稳定 ID 还原索引；非法（非 texture:N 或 N 非整数）返回 null。 */
export function tpfTextureIndexFromStableId(stableId) {
    if (typeof stableId !== 'string')
        return null;
    const prefix = 'texture:';
    if (!stableId.startsWith(prefix))
        return null;
    const rest = stableId.slice(prefix.length);
    if (!/^\d+$/.test(rest))
        return null;
    return Number(rest);
}
//# sourceMappingURL=tpf-editor.js.map