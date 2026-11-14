import type { MsgExport, ParamFieldSymbol, ParamRowSymbol, ReferenceEdge, TextEntrySymbol } from '@soulforge/shared';
/**
 * PARAM 到 FMG 的文本关联。
 *
 * 这两类关系来自成熟工具使用的两种稳定语义：
 * - 字段自身明确是 nameId/textId/msgId 等文本引用；
 * - Sekiro 的 Row-FMG 注释把 EquipParamGoods 等参数行的 rowId 直接映射
 *   到对应的 Title_* 文本表。
 *
 * 这里只用于候选发现和证据图。它不会把文本 ID提升为 PARAM rowId，也
 * 不替代当前工作区的 Bridge 原生读取、sourceHash/sourceRevision 或写入门禁。
 */
export type ParamTextLinkKind = 'field-text-id' | 'row-fmg-id';
export interface ParamTextLink {
    fieldId?: string;
    referenceValue: number;
    kind: ParamTextLinkKind;
    entry: TextEntrySymbol;
}
export type TextEntryLookup = ReadonlyMap<number, readonly TextEntrySymbol[]>;
export interface ParamTextFieldClassifier {
    isTextReferenceField(field: ParamFieldSymbol): boolean;
}
export declare function buildTextEntryLookup(msgExports: readonly MsgExport[]): Map<number, TextEntrySymbol[]>;
/** 只接受明确的非负整数引用；-1 等 PARAM 空槽永远不会变成文本候选。 */
export declare function parseParamTextReference(value: ParamFieldSymbol['value']): number | null;
export declare function createParamTextFieldClassifier(fields: readonly ParamFieldSymbol[]): ParamTextFieldClassifier;
/**
 * PARAM metadata 没有携带完整的 FmgRef XML 属性时，仍只能按字段语义识别
 * 文本引用。字段名/说明不满足明确模式就不查 FMG，避免把 itemId、iconId
 * 等普通整数误解释成 textId。
 */
export declare function isParamTextReferenceField(field: ParamFieldSymbol): boolean;
/**
 * Return all source-backed text entries for one PARAM row. The result is
 * deterministic and bounded so a wide row cannot create a RAG/CPU amplifier.
 */
export declare function collectParamTextLinks(row: ParamRowSymbol, textEntriesById: TextEntryLookup, maxLinks?: number, classifier?: ParamTextFieldClassifier): ParamTextLink[];
/** Search projection shared by native PARAM search and RAG chunk building. */
export declare function paramTextLinkSearchText(links: readonly ParamTextLink[]): string;
/**
 * Build graph edges for PARAM↔FMG links without numeric-fallback noise.
 * This intentionally avoids a module-level full-field token snapshot: the
 * WorkspaceIndex caches the graph by projection generation, while a second
 * snapshot cache retained O(all PARAM fields) and shared a mutable edge array.
 */
export declare function buildParamTextReferenceEdges(params: readonly {
    rows: readonly ParamRowSymbol[];
}[], msgExports: readonly MsgExport[]): ReferenceEdge[];
