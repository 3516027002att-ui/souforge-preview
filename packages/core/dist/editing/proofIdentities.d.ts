import type { HostDeliveredNativeRead } from './nativeReadProofStore.js';
/**
 * PARAM 整表对象键：param-table|外层|规范表。
 *
 * 新建行没有既有行可读，能证明的只有「整张表的行集合被观察过」。它绑定子表内容哈希
 * （version.childHash）并按已交付的物理行索引区间累积，只有页并集覆盖 [0, rowCount)
 * 才能授权新建行；行 id 是否已占用仍由 writer 对自己的新读取判定。
 */
export declare function paramTableObjectKey(input: {
    outerKey: string;
    table: string;
}): string;
/**
 * 一次「整表行集」读取交付的物理行索引切片。
 *
 * 新建行需要调用方看过整张表的行集合（哪些行 id 已占用、插入位置在哪）；单页只证明那一页。
 * 切片是半开区间 [startIndex, endIndex)，索引是物理 rowIndex（0..rowCount 连续）。
 */
export interface ParamTableRowRange {
    startIndex: number;
    endIndex: number;
    totalRows: number;
    pageSize?: number;
}
export declare function paramTableDeliveredRead(input: {
    principal: string;
    workspaceId: string;
    containerPath: string;
    table: string;
    sourceHash?: string;
    rowRange?: ParamTableRowRange;
}): HostDeliveredNativeRead;
/**
 * 外层源键：已解析的绝对路径 → file URL。
 * 裸相对串必须先相对 overlayRoot 解析；解析不出或非文件即失败关闭，
 * 不得用未解析串作键（同容器两种拼写会分裂证明域）。
 */
export declare function outerFileKey(overlayRoot: string | undefined, raw: string | undefined): string;
export declare function paramOuterKey(containerPath: string): string;
/**
 * PARAM 对象键：param|外层|规范表|行|行槽|字段。
 * 行槽缺失时不编造：带 rowIndex 的写入将匹配不到，必须用 rowIndex 重读。
 * entryName 不进入键：写入侧没有该维度；物理行绑定由 writer 的
 * rowIndex + expectedDataHash 精确保证，证明只管“读过该逻辑字段”。
 */
export declare function paramObjectKey(input: {
    outerKey: string;
    table: string;
    rowId: number;
    rowIndex?: number;
    fieldId: string;
}): string;
/**
 * Human-readable form of a proof object key for diagnostics.
 *
 * Keys embed the physical container URI, so a raw key inside an error message gets masked by the
 * path sanitizer and the caller only sees `param|[本机路径已隐藏]` — losing the table, row and field
 * that would tell it what to re-read. Report the logical identity instead.
 */
export declare function describeObjectKey(objectKey: string): string;
export interface ParamReadField {
    table: string;
    rowId: number;
    rowIndex?: number;
    fieldId: string;
    sourceHash?: string;
    sourceRevision?: number;
}
/**
 * 「这些子表」的证明选择器：写 A 表只让 A 表的读证明过期。
 *
 * PARAM 容器里的每个子表（NpcParam / ItemLotParam …）各自是一份独立原生文档，写一张表只替换
 * 那个子项的字节。按外层容器整片失效，会让「读 ItemLot → 写 Npc → 写 ItemLot」在最后一步
 * 拿到 NATIVE_READ_REQUIRED：那张表其实一个字节都没变。
 */
export declare function paramProofTableMatcher(tables: readonly string[]): (objectKey: string) => boolean;
/**
 * 「这些 TAE 段」的证明选择器。键的第 4 段是段身份（index:N / id:N / name:… / group:…）；
 * 一个容器里的每个 .tae 段是独立子项，写第 N 段不影响第 M 段的词条。
 *
 * 无法定位到具体段的键（单段容器的无段身份）按保守处理：一并失效。
 */
export declare function taeProofEntryMatcher(indexes: readonly number[]): (objectKey: string) => boolean;
/** 原生读取结果 → 逐字段已送达证明（调用方保证这些字段确在最终 envelope 中）。 */
export declare function paramDeliveredReads(input: {
    principal: string;
    workspaceId: string;
    containerPath: string;
    fields: ParamReadField[];
}): HostDeliveredNativeRead[];
export declare function emevdObjectKey(sourceUri: string, eventId: number): string;
/**
 * File-level EMEVD identity: the event id set of one source resource.
 *
 * Creating an event has no target content to read, so the per-event
 * `full-event` receipt can never exist. The guarantee that replaces it is the
 * one the caller could actually have obtained: the file's event set, delivered
 * by `read_emevd_outline`. It pins the source version (so a stale file cannot
 * be written) and it is the only read that shows which ids are already taken.
 */
export declare function emevdFileObjectKey(sourceUri: string): string;
/** Whole-file event-set delivery proof; minted only from a canonical outline read. */
export declare function emevdFileSetDeliveredRead(input: {
    principal: string;
    workspaceId: string;
    canonicalSourceUri: string;
    version: HostDeliveredNativeRead['version'];
    eventCount: number;
    /**
     * 这一页实际覆盖的事件索引切片。`read_emevd_outline` 一次只交付一页，证明因此必须
     * 逐页累积：只有页并集覆盖 [0, eventCount) 时，它才等价于「一次读完整份事件集」。
     * 缺省表示这次读没有可校验的页区间，证明库会把它当成「未交付整集」并失败关闭。
     */
    eventRange?: {
        startIndex: number;
        endIndex: number;
        totalEvents: number;
        pageSize?: number;
    };
}): HostDeliveredNativeRead;
/**
 * 整事件已送达证明：对宿主确认的完整 DSL 文本哈希定界。
 * 只有桥接器验证过 complete_native_dsl + complete + 未截断才调用此处。
 */
export declare function emevdDeliveredRead(input: {
    principal: string;
    workspaceId: string;
    canonicalSourceUri: string;
    eventId: number;
    version: HostDeliveredNativeRead['version'];
    dslText: string;
    capability?: string;
}): HostDeliveredNativeRead;
/** One identity for a script body: the container plus the child path inside it. */
export declare function scriptObjectKey(outerKey: string, childPath: string): string;
/** Whole-script delivery proof; only a complete source read may produce it. */
export declare function scriptDeliveredRead(input: {
    principal: string;
    workspaceId: string;
    outerKey: string;
    childPath: string;
    sourceText: string;
    version: HostDeliveredNativeRead['version'];
}): HostDeliveredNativeRead;
export declare function fmgObjectKey(outerKey: string, table: string, id: number): string;
export declare function fmgContainerKey(outerKey: string, table: string): string;
export interface FmgReadEntry {
    table?: string;
    id: number;
    sourceHash?: string;
    sourceRevision?: number;
}
/**
 * FMG 已送达证明：读过的条目逐条记键；条目级证明只授权对这些条目的改写。
 *
 * 新增条目没有既有条目可读，它凭的是「整张表的条目集合已交付」的容器级证明（见
 * fmgContainerDeliveredRead），单个条目或单页条目不足以证明整表。
 */
export declare function fmgDeliveredReads(input: {
    principal: string;
    workspaceId: string;
    outerKey: string;
    table: string;
    entries: FmgReadEntry[];
}): HostDeliveredNativeRead[];
/**
 * 一次「整表条目集合」读取交付的条目序号切片。
 *
 * 新增条目需要调用方看过整张表的条目集合；单页只证明那一页。切片是半开区间
 * [startIndex, endIndex)，索引是条目在原生表中的序号（0..entryCount 连续）。
 */
export interface FmgContainerEntryRange {
    startIndex: number;
    endIndex: number;
    totalEntries: number;
    pageSize?: number;
}
/**
 * FMG 容器级读取证明：只由能自述「这一页覆盖整表哪些条目序号」的读取铸造。
 *
 * 它绑定容器内容哈希（version.childHash），所以容器被写过后页账本另起；条目集合的
 * 页并集覆盖 [0, entryCount) 才能授权新增条目。
 */
export declare function fmgContainerDeliveredRead(input: {
    principal: string;
    workspaceId: string;
    outerKey: string;
    table: string;
    sourceHash?: string;
    entryRange?: FmgContainerEntryRange;
}): HostDeliveredNativeRead;
export interface TaeSectionIdentity {
    taeEntryIndex?: number;
    taeEntryId?: number;
    taeEntryName?: string;
    taeGroup?: string;
}
export declare function taeObjectKey(outerKey: string, chrId: string, animId: number, eventIndex: number, section?: TaeSectionIdentity): string;
export declare function taeActionKey(outerKey: string, chrId: string, animId: number, section?: TaeSectionIdentity): string;
/** 从动作地址 `c1050#A0200.e0` 解析身份；拼写非法返回 null。 */
export declare function parseTaeAddress(address: string): {
    chrId: string;
    animId: number;
    eventIndex: number;
    taeEntryIndex?: number;
    taeEntryId?: number;
    taeEntryName?: string;
    taeGroup?: string;
} | null;
export interface TaeReadEvent {
    eventTypeId?: number;
    chrId?: string;
    animId: number;
    eventIndex: number;
    startFrame?: number;
    endFrame?: number;
    fieldNames?: string[];
    fieldIndices?: number[];
    taeEntryIndex?: number;
    taeEntryId?: number;
    taeEntryName?: string;
    taeGroup?: string;
}
export declare function taeDeliveredReads(input: {
    principal: string;
    workspaceId: string;
    outerKey: string;
    chrId: string;
    events: TaeReadEvent[];
    /**
     * True when the container holds exactly one TAE entry, so the entry index carries no information.
     * A read then also covers the section-less identity, which is what a short address such as
     * c6210#A3000.e0 resolves to on the write side. Without it the caller can read an event and still
     * be refused with NATIVE_READ_REQUIRED, because the two keys never meet. Multi-entry containers
     * keep the strict sectioned identity.
     */
    singleSection?: boolean;
}): HostDeliveredNativeRead[];
export declare function msbObjectKey(outerKey: string, nativeOffset: number): string;
export declare function msbAddressKey(outerKey: string, address: string): string;
export interface MsbReadPart {
    address?: string;
    nativeOffset?: number;
    posX?: number;
    posY?: number;
    posZ?: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
}
export declare function msbDeliveredReads(input: {
    principal: string;
    workspaceId: string;
    outerKey: string;
    parts: MsbReadPart[];
}): HostDeliveredNativeRead[];
export declare function msbModifiedFields(edit: Record<string, unknown>): string[];
