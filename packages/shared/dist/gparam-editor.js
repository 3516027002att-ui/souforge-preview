/**
 * Sekiro GPARAM（.gparam / .gparam.dcx）typed 文档类型。
 *
 * 与 Bridge 的 read-gparam-document envelope 一一对应（GPARAM-11A）。
 * 布局权威在 C# 侧 GparamNativeDocument.cs；这里的类型只描述 wire 形状，
 * 不维护第二套 native parser。
 *
 * 值语义：values 里 byte/short/int/float 都是 number（double），
 * bool 是 0/1，byte4 是 4 个 0-255，float2/3/4 是 2/3/4 个 f32。
 */
export {};
//# sourceMappingURL=gparam-editor.js.map