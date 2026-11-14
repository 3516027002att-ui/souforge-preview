import type { Diagnostic, ParamDefDocument } from '@soulforge/shared';
import type { ParamReadDelivery } from './paramReadWindow.js';
import type { ParamDecodedCell } from '../editing/paramBridgeCommit.js';
import type { NativeEditSession } from '../editing/nativeEditSession.js';
import { type FieldCandidate, type FieldMatchChannel, type FieldMatchSource } from './fieldSemantics.js';
export interface ParamRowSlot {
    rowIndex: number;
    id: number;
    dataBase64: string;
    dataHash: string;
    name?: string;
    /** Native encoding the row name was decoded from (utf16le / shiftjis / ascii). */
    nameEncoding?: string;
    /**
     * Bridge-decoded cells of this row, present only when the caller asked for field
     * values. `read_param_fields` projects these; it never decodes row bytes itself.
     */
    cells?: ParamDecodedCell[];
}
export interface ParamFieldEdit {
    table: string;
    rowId: number;
    fieldId: string;
    value: number | string | boolean;
    rowIndex?: number;
    expectedDataHash?: string;
}
export interface ParamFieldReadQuery {
    table: string;
    rowIds: number[];
    fieldIds: string[];
    rowIndex?: number;
}
export interface ParamFieldSnapshot {
    table: string;
    rowId: number;
    rowIndex?: number;
    dataHash?: string;
    /** Physical BND4 child identity returned by the native read. */
    entryName?: string;
    entryIndex?: number;
    /** Native row name returned by the PARAM document, when available. */
    rowName?: string;
    fieldId: string;
    displayName?: string;
    description?: string;
    /** Native metadata reference target, for example ResourceItemLotParam. */
    refs?: string;
    /** Provenance returned by the same native document read, never a cached index fallback. */
    sourceHash?: string;
    /**
     * Content-derived revision of `sourceHash` (`paramContentRevision`): identical bytes always
     * produce the identical number, so a write+rollback keeps a caller's identity valid. Not a mtime.
     */
    sourceRevision?: number;
    /** The rule behind `sourceRevision`; PARAM live reads are always content-derived. */
    sourceRevisionKind?: 'content-hash';
    /**
     * The same content revision, under the name that is comparable across read/mutate/search.
     * `search_param_rows` labels its mtime `sourceRevisionKind: 'file-mtime'` and publishes the
     * content-derived value here, so a caller can use one field for CAS without guessing a tool's rule.
     */
    contentRevision?: number;
    value: number | string | boolean | null;
}
export interface ParamEditFailure {
    code: string;
    message: string;
    details?: unknown;
}
export type ParamReadResult = {
    ok: true;
    containerPath: string;
    fields: ParamFieldSnapshot[];
    /** Definitions are returned once per page, never repeated per cell. */
    fieldDefinitions?: ParamFieldDefinitionSnapshot[];
    missingRows: Array<{
        table: string;
        rowId: number;
    }>;
    missingFields?: Array<{
        table: string;
        fieldId: string;
        rowIds: number[];
    }>;
    nextActions?: Array<{
        tool: 'search_param_fields';
        args: {
            table: string;
            rowIds: number[];
            query: string;
            containerPath: string;
        };
        reason: string;
    }>;
    diagnostics: Diagnostic[];
    pagination?: {
        offset: number;
        returnedCount: number;
        totalCount: number;
        hasMore: boolean;
        nextCursor: string | null;
        pageSize: number;
        queryScope: string;
    };
    execution?: {
        status: 'completed' | 'partial' | 'failed';
        native: 'completed' | 'partial' | 'failed';
    };
    scan?: {
        status: 'complete' | 'partial';
        requestedRows: number;
        matchedRows: number;
        missingRows: number;
        missingFields?: number;
    };
    page?: {
        status: 'complete' | 'partial';
        source: 'native';
        offset: number;
        remaining: number;
    };
    /**
     * Cumulative delivery for the whole read, not just this page: `cellsDeliveredThrough` is the
     * boundary `pagination.offset` + this page's cell count. A caller that reads page 2 therefore
     * sees the rows page 1 already completed as delivered instead of being told they are missing.
     */
    delivery?: ParamReadDelivery;
    evidence?: {
        status: 'complete' | 'partial' | 'stale';
        sourceHash: string;
        sourceRevision?: number;
        /** `content-hash`: the revision was derived from `sourceHash`, never from a file mtime. */
        sourceRevisionKind?: 'content-hash';
        /**
         * Content-derived revision of `evidence.sourceHash`. A single-child page reports the PARAM
         * child hash, so this equals `search_param_rows`' `contentRevision` for the same rows; a page
         * spanning several children reports the composite delivery hash and is not a child version.
         */
        contentRevision?: number;
        complete: boolean;
    };
} | {
    ok: false;
    error: ParamEditFailure;
    diagnostics: Diagnostic[];
};
export interface ParamFieldDefinitionSnapshot {
    fieldId: string;
    name: string;
    type: string;
    description?: string;
    /** Native metadata reference target, for example ResourceItemLotParam. */
    refs?: string;
    /** 该字段属于哪张表（容器条目名，例如 NpcParam）。字段搜索每条都带，读路径不带。 */
    table?: string;
    /**
     * 命中通道：`fieldId` 字段 id 字面命中；`name` native 名字面命中；
     * `description` 只有说明文本里提到（弱证据，永远排在 name 之后）；
     * `cjk-variant` 只有折叠繁简或中文标签后才相等。列出整表（query 为空）时不带。
     */
    matchedBy?: FieldMatchChannel;
    /** 命中的具体列，比 matchedBy 更细。 */
    matchedField?: FieldMatchSource;
    /** 命中的词元，最多 6 个，便于调用方判断为什么命中。 */
    matchedTerms?: string[];
    /** `matchedBy === 'description'` 时给出说明原文片段（命中词前后各约 24 字）。 */
    descriptionSnippet?: string;
}
export type ParamFieldDefinitionResult = {
    ok: true;
    containerPath: string;
    table: string;
    entryName: string;
    entryIndex: number;
    rowIds: number[];
    sourceHash: string;
    /** Content-derived revision of `sourceHash`, not the container mtime. */
    sourceRevision?: number;
    /** `content-hash`: `sourceRevision` is derived from the PARAM child hash. */
    sourceRevisionKind?: 'content-hash';
    /** Cross-tool name for the same content revision (see `ParamFieldSnapshot.contentRevision`). */
    contentRevision?: number;
    /**
     * 保留的命中来自哪里：只有字段 id/名字命中；只有说明文本命中；或两者都有
     * （说明命中排在 id/名字命中之后）。
     */
    matchScope?: 'field-id-or-name' | 'description-only' | 'field-id-or-name+description';
    /** Which term-coverage rule kept the rows: all terms, at least half, or any single term. */
    matchMode?: 'all-terms' | 'majority-terms' | 'any-term';
    /** 命中了某个词元、但没过覆盖度规则而被丢弃的字段数。 */
    droppedWeakMatches?: number;
    /** 被覆盖度规则丢掉的字段 id（有界），让调用方看见被丢的是什么。 */
    droppedFieldIds?: string[];
    /** 规范化（折叠繁简 + 小写）后的查询，回显给调用方；返回的字段名仍是数据原文。 */
    normalizedQuery?: string;
    /** 查询命中的语义概念 id，例如 ["distance"]。 */
    conceptIds?: string[];
    /**
     * 同一句查询在 TAE 事件字段里的强候选。只包含收录中文标签命中或整名精确命中，
     * 每条带 `eventTypeId` / `eventName` / `semantics`；PARAM 的结果不受影响。
     */
    crossDomainFields?: FieldCandidate[];
    /** 本表零命中时最接近的字段名（数据原文），不是「没有这个字段」的结论。 */
    nearestFields?: Array<{
        fieldId?: string;
        name: string;
        table?: string;
        paramType?: string;
        reason: string;
    }>;
    fields: ParamFieldDefinitionSnapshot[];
    total: number;
    totalCount: number;
    offset: number;
    limit: number;
    returned: number;
    returnedCount: number;
    truncated: boolean;
    nextCursor?: string;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: ParamEditFailure;
    diagnostics: Diagnostic[];
};
export type ParamSetResult = {
    ok: true;
    containerPath: string;
    before: ParamFieldSnapshot[];
    after: ParamFieldSnapshot[];
    changedTables: string[];
    /**
     * One Patch Engine operation per changed table, in commit order. A cross-table edit is
     * several operations (each repacks the same container), so reporting a single opId would
     * be a lie; this is the pair the caller actually needs to roll back.
     */
    operations: Array<{
        table: string;
        opId: string;
    }>;
    /** The same handles as a flat list, in the order the tables were committed. */
    opIds: string[];
    /** Present when this call created a row instead of editing existing ones. */
    created?: ParamCreatedRow;
    /** Present with `created`: the post-commit whole-table native reread outcome. */
    verification?: ParamPostCommitVerification;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: ParamEditFailure;
    diagnostics: Diagnostic[];
    before?: ParamFieldSnapshot[];
};
/** Encoding label a new row's name is written with. */
export type ParamRowNameEncoding = 'utf16le' | 'shiftjis' | 'ascii';
/**
 * A row creation request. `fields` are absolute values applied after the copy/zero base;
 * `copyFrom` copies every byte of an existing row before those edits, so a caller does not
 * have to know or re-specify the other fields.
 */
export interface ParamRowCreateRequest {
    table: string;
    rowId: number;
    rowName: string;
    fields?: Array<{
        fieldId: string;
        value: number | string | boolean;
    }>;
    copyFrom?: {
        table?: string;
        rowId: number;
        rowIndex?: number;
    };
    nameEncoding?: ParamRowNameEncoding;
}
/** Receipt for a committed row creation: the physical position and the identity of the new row. */
export interface ParamCreatedRow {
    table: string;
    rowId: number;
    rowName: string;
    /** Physical slot the new row occupies in the rebuilt ordered row table. */
    rowIndex: number;
    /** `rowIndex` the Bridge was asked for (native tables are ordered ascending by id). */
    insertIndex: number;
    dataHash: string;
    nameEncoding: ParamRowNameEncoding;
    copyFrom?: {
        table: string;
        rowId: number;
        rowIndex?: number;
    };
    beforeFields: Record<string, number | string | boolean | null>;
    afterFields: Record<string, number | string | boolean | null>;
    rowCountBefore: number;
    rowCountAfter: number;
}
interface ContainerEntry {
    index: number;
    name: string;
    contentHash: string;
}
/**
 * Remove one PARAM read handoff directory without ever accepting an arbitrary
 * path from a caller.  The remove operation is injectable only for the small
 * contract smoke: production always uses fs.rm, while the smoke can exercise
 * retry and failure diagnostics deterministically without changing ACLs on a
 * real workspace.
 */
export declare function cleanupParamTempDirectory(input: {
    stagingRoot: string;
    tempDirectory: string;
    containerPath: string;
    remove?: (path: string) => Promise<void>;
}): Promise<Diagnostic | undefined>;
export declare function groupParamEdits(edits: ParamFieldEdit[]): Map<string, ParamFieldEdit[]>;
export declare function applyEditsToRowBytes(input: {
    rowDataBase64: string;
    definition: ParamDefDocument;
    edits: Array<{
        fieldId: string;
        value: number | string | boolean;
    }>;
}): {
    ok: true;
    nextDataBase64: string;
    before: Record<string, number | string | boolean | null>;
    after: Record<string, number | string | boolean | null>;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function resolveGameparamContainer(overlayRoot: string, explicit?: string): Promise<{
    ok: true;
    path: string;
} | {
    ok: false;
    error: ParamEditFailure;
}>;
/**
 * Content-derived `sourceRevision` for a PARAM read.
 *
 * The revision a caller keeps next to `sourceHash` is an equality token for the delivered
 * bytes, not a filesystem version. It used to be the container's mtime, so a write+rollback
 * that restored every byte still produced a different revision and invalidated the caller's
 * pre-write identity. Deriving it from the same content hash the read reports makes identical
 * bytes keep the identical revision; `contentRevisionFromHash` is the EMEVD implementation of
 * that rule (48 bits, safe integer), reused here so both domains cannot drift apart.
 */
export declare function paramContentRevision(sourceHash: string | undefined): number | undefined;
export declare function readParamFields(input: {
    edit: NativeEditSession;
    queries: ParamFieldReadQuery[];
    containerPath?: string;
    cursor?: string;
    /**
     * Zero-based cell index into the same stable collection `pagination.totalCount` counts; the position
     * an opaque cursor encodes. `offset` and `cursor` are two spellings of one window, so passing both is
     * rejected instead of silently preferring one (a request for page 2 that re-read page 1 is the exact
     * failure this field was declared for and then dropped at this boundary).
     */
    offset?: number;
    pageSize?: number;
}): Promise<ParamReadResult>;
/**
 * 整表行集的一页：只交付「物理行索引 + 行 id（+ 行名）」，不交付字段值。
 *
 * 新建 PARAM 行没有既有行可读，能证明的只有「整张表的行集合被观察过」。read_param_fields
 * 的字段读一次只交付调用方点名的若干行，无法自述「这一页覆盖全表哪一段」，因此不铸造
 * 整表证明；本函数才是那个可分页、能自述切片（rowOffset/rowReturned/rowCount）的读取入口。
 * 返回的 rowCount 是整表物理行数，rowOffset/rowReturned 是本次交付的物理行索引区间。
 */
export interface ParamRowIdentity {
    rowIndex: number;
    rowId: number;
    rowName?: string;
}
export type ParamRowsPageResult = {
    ok: true;
    containerPath: string;
    table: string;
    rowCount: number;
    rowOffset: number;
    rowLimit: number;
    rowReturned: number;
    hasMore: boolean;
    nextOffset?: number;
    rows: ParamRowIdentity[];
    sourceHash: string;
    sourceRevision?: number;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: ParamEditFailure;
    diagnostics: Diagnostic[];
};
export declare function readParamRowsPage(input: {
    edit: NativeEditSession;
    table: string;
    containerPath?: string;
    rowOffset?: number;
    rowLimit?: number;
}): Promise<ParamRowsPageResult>;
/**
 * Search the trusted definition for fields relevant to an already resolved
 * native row. This is deliberately separate from read_param_fields: it lets
 * the Agent obtain real field IDs without sending an unbounded full-row read,
 * while the subsequent value read still requires an explicit non-empty list.
 */
export declare function searchParamFieldDefinitions(input: {
    edit: NativeEditSession;
    table: string;
    rowIds: number[];
    query: string;
    limit?: number;
    cursor?: string;
    containerPath?: string;
}): Promise<ParamFieldDefinitionResult>;
/**
 * 旧接口，保留给既有调用方：语义词表已移到 `fieldSemantics.ts` 的 FIELD_CONCEPTS，
 * 这里只做转发，避免两套中英词表各自漂移。
 */
export declare function expandParamFieldQuery(query: string): string[];
export declare function setParamFields(input: {
    edit: NativeEditSession;
    edits: ParamFieldEdit[];
    /** Create a new row instead of editing existing ones; mutually exclusive with `edits`. */
    create?: ParamRowCreateRequest;
    containerPath?: string;
}): Promise<ParamSetResult>;
/**
 * Where a new row belongs in the ordered native row table.
 *
 * Sekiro row tables are strictly ascending by row id; the game and every reference tool find a
 * row by walking/halving that order, so appending id 770064 after 3952050 (or after 770080) would
 * produce a table that reads back but is no longer the shape the format promises. Insert before
 * the first larger id. A table that is not strictly ascending (duplicates, hand-edited order) is
 * left alone: appending is the only choice that never re-sorts rows the caller did not ask to
 * move.
 */
export declare function computeParamRowInsertIndex(rows: ReadonlyArray<{
    rowIndex: number;
    id: number;
}>, rowId: number): number;
/**
 * Create one PARAM row through the full Patch Engine path: unpack → write-param `add` → write-bnd4
 * → applyNativeMutation (staging, backup, journal, rollback handle) → native whole-table reread.
 *
 * The row is inserted at its sorted position in the ordered row table, never appended past larger
 * ids, and an occupied rowId is refused before any staging (`PARAM_ROW_ALREADY_EXISTS`). After the
 * commit every pre-existing row is re-read and compared by (id, dataHash), so "only the new row
 * changed" is a checked postcondition rather than an assumption about the writer.
 */
export declare function createParamRow(input: {
    edit: NativeEditSession;
    table: string;
    rowId: number;
    rowName: string;
    fields?: Array<{
        fieldId: string;
        value: number | string | boolean;
    }>;
    copyFrom?: {
        table?: string;
        rowId: number;
        rowIndex?: number;
    };
    nameEncoding?: ParamRowNameEncoding;
    containerPath?: string;
}): Promise<ParamSetResult>;
/** Outcome of the post-commit native reread, shaped like `NativePostWriteVerification`. */
export type ParamPostCommitVerification = {
    ok: true;
    details: Record<string, unknown>;
} | {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
/**
 * Re-read the whole target table from the committed container and verify a creation:
 * the row exists exactly once at `expectedRowIndex` with the expected name and data hash, the
 * requested field values decode back, and every pre-existing (id, dataHash) pair is still present.
 */
export declare function verifyCreatedParamRow(input: {
    edit: NativeEditSession;
    table: string;
    rowId: number;
    rowName: string;
    expectedDataHash: string;
    expectedRowIndex: number;
    rowCountBefore: number;
    beforeRows: ReadonlyArray<{
        id: number;
        dataHash: string;
    }>;
    expectedFields?: ReadonlyArray<{
        fieldId: string;
        value: number | string | boolean | null;
    }>;
    containerPath: string;
}): Promise<ParamPostCommitVerification>;
/**
 * 这次写入（或写入前的内容锚点）将要落到的那张物理子表。
 *
 * 调用方拼写可以是一个原生类型名（`BEHAVIOR_PARAM_ST`），它同时对应
 * `BehaviorParam.param` 与 `BehaviorParam_PC.param`。锚点必须绑定到**实际那张子表**，
 * 否则「读 PC、写 PC」在同容器另一张表被写过之后会因为没有内容锚点而作废。
 * 这里复用写入路径自己的 `findTableEntries` + `selectParamTableRows` 判定，不另写一套
 * 拼写规则。
 *
 * 判定不出来（请求的行在多张候选表里都有 / 哪张都没有 / 原生读取失败 / 枚举失败）时
 * 返回 undefined：调用方必须按「没有内容锚点」失败关闭，绝不猜一张表。
 */
export declare function resolveParamWriteTargetIdentity(input: {
    edit: NativeEditSession;
    containerPath: string;
    table: string;
    rowIds: readonly number[];
}): Promise<{
    entryIndex: number;
    tableName: string;
} | undefined>;
/**
 * Resolve a caller table spelling to the logical family it names.  The
 * `_ST` type suffix and the known English alias are removed, while an
 * explicit physical child (`AtkParam_Npc`) keeps its own key so the two
 * siblings can still be distinguished.
 */
export declare function paramTableAliasKey(value: string): string;
/**
 * All physical entries a caller table spelling can name, most specific first.
 *
 * A native type can back several physical children: ATK_PARAM_ST is stored as
 * both AtkParam_Npc.param and AtkParam_Pc.param.  Returning every child lets
 * the loader disambiguate with the requested row ids; returning `undefined`
 * (the old behaviour) turned a readable table into "容器内没有表".
 */
export declare function findTableEntries(entries: ContainerEntry[], wanted: string): ContainerEntry[];
/**
 * Which probed physical child answers this row request.
 *
 * A native type name can back several children, so a request is only servable
 * when exactly one child holds every requested row (`complete`) or, failing
 * that, when exactly one child holds any of them (`partial`).  Two complete
 * children (a row id that exists in both) and two partial children (the rows
 * are spread across siblings) are ambiguous: picking the first candidate would
 * silently read a table the caller did not ask for.
 */
export declare function selectParamTableRows<T extends {
    missingRows: readonly number[];
}>(probes: readonly T[], rowIds: readonly number[]): {
    status: 'complete';
    chosen: T;
} | {
    status: 'partial';
    chosen: T;
} | {
    status: 'ambiguous';
} | {
    status: 'missing';
};
export declare function normalizeTableToken(value: string): string;
/**
 * Row width of a single-row 32-bit PARAM from the trusted first-party definition. The Bridge cannot bound such a row
 * alone (PARAM_ROW_SIZE_REQUIRED) and readParamDocumentViaBridge retries with this width. undefined when no definition
 * matches: the caller fails the read instead of guessing. compare/run.mjs uses it too, so the comparison drives the
 * same read path as the editor.
 */
export declare function resolveTrustedParamRowWidth(header: {
    typeName: string;
    dataVersion: number;
}, game: string): Promise<number | undefined>;
/**
 * 可信字段定义（first-party ParamDefDocument），给 Bridge 的 decodeFields 用。
 * 与 resolveTrustedParamRowWidth 走同一条元数据链：类型名、数据版本、行宽必须
 * 唯一匹配；不匹配时返回 undefined，调用方不得改用猜测的字段布局解码。
 *
 * 解码本身在 Bridge（原生行字节的唯一生产权威）；这里只提供「哪些偏移是什么
 * 类型」的 schema，Bridge 拒绝任何 typeName/dataVersion/rowDataSize 不一致的定义。
 */
export declare function resolveTrustedParamDefinition(header: {
    typeName: string;
    dataVersion: number;
}, game: string): Promise<ParamDefDocument | undefined>;
export {};
