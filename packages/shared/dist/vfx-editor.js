/**
 * Sekiro FXR3（.fxr / ffxbnd.dcx 子项，FFX particle effect）只读文档 wire 类型
 * 与三页投影（VFX-54A）。与 Bridge 的 read-fxr-document 一一对应。
 *
 * 布局权威在 C# 侧 FxrNativeDocument.cs；这里的类型只描述 wire 形状，
 * 不维护第二套 native parser。
 *
 * 语义：
 *  - authority 上限是 candidate（无 writer、Section11 无 schema、Section9 /
 *    Section12-14 未在真实样本验证）；真实语料恒为 partial——发现未识别 node
 *    type 或 Section11 有数据时 C# 侧登记 unparsedGaps 并降 partial，
 *    上层不得把「读出来了」伪装成「完整解析」。
 *  - `unparsedGaps` 表达**能力边界**（本版没读/没验证），`layoutWarnings`
 *    表达**数据可疑**（读到的东西不对）。两者都会压 authority，但处置方向相反。
 *  - Section11 值是混合 int/float 位模式的 int32，无 schema，C# 按不透明
 *    int 数组上报；消费方不得据值做类型推断。
 *
 * `projectFxrDocumentPages` 是纯函数，消费方用它把单个 envelope 投影成
 * effect / nodes / fields 三页，不做任何 I/O。
 */
/** 把 read-fxr-document envelope 投影成三页。纯函数，不吞异常、不做 I/O。 */
export function projectFxrDocumentPages(doc) {
    return {
        effect: {
            format: doc.format,
            version: doc.version,
            resourceId: doc.resourceId,
            rootNodeCount: doc.rootNodeCount,
            nodes: doc.effect?.nodes ?? [],
            nodesTruncated: doc.effect?.nodesTruncated ?? false,
            authority: doc.authority,
        },
        nodes: {
            total: doc.nodes?.total ?? 0,
            byType: doc.nodes?.byType ?? [],
            authority: doc.authority,
        },
        fields: {
            hosts: doc.fields?.hosts ?? [],
            hostsTruncated: doc.fields?.hostsTruncated ?? false,
            authority: doc.authority,
        },
    };
}
/** 窄守卫：判读一个 read-fxr-document 响应是不是 FxrDocument。 */
export function isFxrDocument(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.format === 'FXR3'
        && v.formatId === 'fxr'
        && typeof v.sourceHash === 'string'
        && typeof v.authority === 'string'
        && typeof v.roundTrip === 'object'
        && v.roundTrip !== null;
}
//# sourceMappingURL=vfx-editor.js.map