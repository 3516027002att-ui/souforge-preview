/**
 * Unified reference-query contract (执行指令 §3/§4).
 *
 * Everything the Agent, CLI and desktop share for `find_references`:
 * request DTO with a strict decoder, discriminated target selectors, the
 * reference-page record shape, and the certainty/resolution enums.
 *
 * The decoder is the only gate that turns model-authored JSON into a
 * normalized query. It rejects non-safe integers, NaN/Infinity, empty
 * strings, unknown keys and mutually-exclusive target entries BEFORE any
 * reader sees the input. Nested objects are validated field by field —
 * `ToolInputShape` can only describe top-level types.
 */
export type ReferenceDirection = 'from' | 'to' | 'both';
export type ReferenceDetail = 'edges' | 'context';
/** Relation nature. Deliberately separate from the legacy high/medium/low confidence. */
export type ReferenceCertainty = 'confirmed' | 'indirect' | 'hypothesis';
export type ReferenceResolution = 'resolved' | 'ambiguous' | 'insufficient_evidence' | 'not_found';
/** How a statement was obtained; never claim `source-text` for rendered or decompiled views. */
export type ReferenceStatementKind = 'native-rendered' | 'source-text' | 'decompiled-view' | 'field-assignment';
export type ReferenceRelationKind = 'calls_event' | 'reads_flag' | 'writes_flag' | 'references_map_entity' | 'references_region' | 'references_param_row' | 'references_text' | 'invokes_script' | 'contains' | 'member_of' | 'numeric_match' | 'name_match' | 'unknown';
/** Discriminated selector; no catch-all object with arbitrary properties. */
export type ReferenceTargetSelector = {
    objectHandle: string;
} | {
    domain: 'param';
    sourceUri: string;
    entryIndex: number;
    entryName?: string;
    rowId: number;
    rowIndex?: number;
} | {
    domain: 'emevd';
    sourceUri: string;
    eventId: number;
} | {
    domain: 'fmg';
    sourceUri: string;
    childChain: string[];
    category: string;
    language?: string;
    textId: number;
    entryIndex?: number;
} | {
    domain: 'script';
    sourceUri: string;
    childChain: string[];
    scriptEntryIndex?: number;
} | {
    domain: 'map';
    sourceUri: string;
    nativeObjectKey: string;
} | {
    domain: 'tae';
    sourceUri: string;
    childChain: string[];
    taeEntryIndex: number;
    animId: number;
    eventIndex?: number;
} | {
    domain: 'resource';
    sourceUri: string;
    childChain: string[];
    nativeObjectKey?: string;
};
export interface ReferenceQueryInput {
    uri?: string;
    target?: ReferenceTargetSelector;
    query?: string;
    domain?: string;
    direction?: ReferenceDirection;
    detail?: ReferenceDetail;
    fieldIds?: string[];
    depth?: number;
    limit?: number;
    includeHypotheses?: boolean;
    cursor?: string;
    /** Host enrichment scan continuation; distinct from result-page cursor. */
    sourceCursor?: string;
}
export type ReferenceQueryErrorCode = 'REFERENCE_TARGET_REQUIRED' | 'REFERENCE_TARGET_CONFLICT' | 'REFERENCE_CURSOR_SCOPE_MISMATCH' | 'REFERENCE_CURSOR_KIND_MISMATCH' | 'REFERENCE_INVALID_INPUT';
export interface ReferenceQueryDecodeFailure {
    ok: false;
    code: ReferenceQueryErrorCode;
    message: string;
    field?: string;
}
export interface NormalizedReferenceQuery {
    uri?: string;
    target?: ReferenceTargetSelector;
    query?: string;
    domain?: string;
    direction: ReferenceDirection;
    detail: ReferenceDetail;
    fieldIds?: string[];
    depth: number;
    limit: number;
    includeHypotheses: boolean;
    cursor?: string;
    sourceCursor?: string;
    /** Cursor continuation requests must match the host-stored scope exactly. */
    cursorScopeCheckRequired: boolean;
}
export type ReferenceQueryDecodeResult = {
    ok: true;
    input: NormalizedReferenceQuery;
} | ReferenceQueryDecodeFailure;
export declare const REFERENCE_DEPTH_DEFAULT = 3;
export declare const REFERENCE_DEPTH_MIN = 1;
export declare const REFERENCE_DEPTH_MAX = 4;
export declare const REFERENCE_LIMIT_DEFAULT = 8;
export declare const REFERENCE_LIMIT_MIN = 1;
export declare const REFERENCE_LIMIT_MAX = 32;
/**
 * Strict decode of a model-authored `find_references` argument object.
 *
 * First requests must carry exactly one of uri / target / query.
 * Cursor continuations must not re-declare a target entry (host compares the
 * remaining scope against the stored query and rejects mismatches).
 */
export declare function decodeReferenceQueryInput(raw: unknown): ReferenceQueryDecodeResult;
export interface ReferenceSourceVersionDto {
    sourceUri: string;
    outerFileHash?: string;
    payloadHash?: string;
    sourceRevision?: number;
    readerSchemaVersion?: string | number;
    metadataSchemaVersion?: string | number;
    generation?: number;
}
/** Full stable identity of one object; never derived from display names alone. */
export interface ReferenceObjectIdentity {
    workspaceId: string;
    domain: string;
    sourceUri: string;
    childChain?: string[];
    entryIndex?: number;
    entryName?: string;
    rowId?: number;
    rowIndex?: number;
    eventId?: number;
    textId?: number;
    animId?: number;
    eventIndex?: number;
    taeEntryIndex?: number;
    nativeObjectKey?: string;
    /** Host-issued lookup key only; not a proof of anything. */
    objectHandle?: string;
    label?: string;
}
export interface ReferenceStatementLocation {
    instructionIndex?: number;
    instructionBank?: number;
    instructionId?: number;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    byteRange?: [number, number];
    fieldId?: string;
}
export interface ReferenceStatementDto {
    kind: ReferenceStatementKind;
    text: string;
    truncated?: boolean;
    location?: ReferenceStatementLocation;
}
export interface ReferenceFieldFactDto {
    fieldId: string;
    value: string | number | boolean | null;
    rowId?: number;
    rowIndex?: number;
    dataHash?: string;
    /** Metadata rule that made this field a reference (e.g. parsed Refs fragment). */
    metadataRule?: string;
    conditionField?: string;
    conditionValue?: number;
}
export interface ReferenceEvidenceDto {
    sourceUri: string;
    /** Bounded source snippet retained for content projection; never a proof by itself. */
    excerpt?: string;
    sourceVersion?: ReferenceSourceVersionDto;
    statement?: ReferenceStatementDto;
    fieldFact?: ReferenceFieldFactDto;
    /** Native addressing kept for host-side proof; path-sanitized for display. */
    nativeLocation?: Record<string, unknown>;
}
export interface ReferencePathHop {
    from: ReferenceObjectIdentity;
    /**
     * 该跳所属关联边的目标。方向与 relation 的 from→to 一致，而不是遍历方向：
     * direction=to 时 relation 是「引用方→目标」，path 也必须同向。
     * 旧页可能缺失。
     */
    to?: ReferenceObjectIdentity;
    relationKind: ReferenceRelationKind;
    certainty: ReferenceCertainty;
}
export interface ReferenceRelationItem {
    relationId: string;
    from: ReferenceObjectIdentity;
    to: ReferenceObjectIdentity;
    relationKind: ReferenceRelationKind;
    certainty: ReferenceCertainty;
    evidence: ReferenceEvidenceDto[];
    path: ReferencePathHop[];
    /** Provider rule/explanation; evidence remains host-side and is not exported by the content projection. */
    reason?: string;
    /** Explicit heuristic rule name; required when certainty is hypothesis. */
    ruleName?: string;
    /** Whether the referenced native target currently exists. */
    targetStatus?: 'present' | 'missing' | 'ambiguous' | 'unverified';
}
export interface ReferenceCandidateDto {
    identity: ReferenceObjectIdentity;
    discriminators: Record<string, unknown>;
}
export interface ReferenceTargetReadFieldDto {
    fieldId: string;
    value: string | number | boolean | null;
    rowId?: number;
    rowIndex?: number;
    dataHash?: string;
}
export interface ReferenceTargetReadDto {
    fields: ReferenceTargetReadFieldDto[];
    completeness: 'complete' | 'windowed' | 'summary_only' | 'partial';
    /** Requested field ids that were not present in the indexed projection. */
    missingFieldIds?: string[];
}
export interface ReferenceContextDto {
    target?: ReferenceObjectIdentity;
    statements: ReferenceStatementDto[];
    evidence: ReferenceEvidenceDto[];
}
export interface ReferenceDomainCoverageDto {
    domain: string;
    status: 'complete' | 'partial' | 'unscanned' | 'not_indexed' | 'unknown';
    discoveredSources: number;
    readSuccessSources: number;
    parsedSuccessSources: number;
    unscannedSources: string[];
    failedSources: string[];
}
/** 参数化（无法归属）实参的查询级计数，供调用方判断否定结论为何降级。 */
export interface ReferenceParameterizedCoverageDto {
    role: 'entity' | 'event' | 'text';
    scope: 'instruction' | 'instruction-contains' | 'any';
    relevant: number;
    total: number;
    instructions: Array<{
        name: string;
        count: number;
    }>;
    unrelatedInstructions?: Array<{
        name: string;
        count: number;
    }>;
    otherRoleCount: number;
    filesInScope: number;
    filesUnread: number;
}
/**
 * 查询范围里某个来源域的来源计数。`totalSources` 是该域**能产生引用**的来源
 * 总数（例如 PARAM 域的参数表容器，不含 gpram 这类不会产生行引用的文件），
 * 而不是工作区该域的文件总数；两者混用会让同域查询永远显得“没读完”。
 */
export interface ReferenceQueryScopeSourceDto {
    domain: string;
    totalSources: number;
    readSources: number;
    staleSources: number;
}
/** 本次查询自己的覆盖范围；`negativeConclusionAllowed` 只由它决定。 */
export interface ReferenceQueryScopeDto {
    /** 能产生本次查询目标引用的来源域。 */
    domains: string[];
    /** 这些来源域是否在本次查询范围内全部读全。 */
    complete: boolean;
    /** 逐来源域计数；缺失表示宿主没有给出查询级来源范围。 */
    sources?: ReferenceQueryScopeSourceDto[];
}
export interface ReferenceCoverageDto {
    scope: string;
    status: 'complete' | 'partial' | 'unscanned' | 'not_indexed' | 'unknown';
    domains: ReferenceDomainCoverageDto[];
    predicateComplete: boolean;
    /** Only true when a complete-scope exhaustive predicate allows a negative conclusion. */
    negativeConclusionAllowed: boolean;
    /** 本次查询自己的覆盖范围；缺失表示没有查询级覆盖度来源。 */
    queryScope?: ReferenceQueryScopeDto;
}
export interface DependencySummaryEntry {
    sourceKey: string;
    outerFileHash?: string;
    payloadHash?: string;
    sourceRevision?: number;
    generation?: number;
}
export interface DependencySummaryDto {
    catalogGeneration: number;
    readerSchemaVersion?: string | number;
    metadataSchemaVersion?: string | number;
    entries: DependencySummaryEntry[];
}
export interface ReferencePageDto {
    returnedCount: number;
    hasMore: boolean;
    nextCursor?: string;
    truncationReason?: string;
    dependencySummary?: DependencySummaryDto;
}
export interface ReferenceDiagnosticDto {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    sourceUri?: string;
}
export interface ReferenceNextActionDto {
    tool: string;
    args: Record<string, unknown>;
    reason: string;
}
/**
 * Renderer/Agent-safe relation projection.  It deliberately carries the
 * useful content and location while omitting provider evidence, source
 * versions, hashes and native proof fields.
 */
export interface ReferenceSearchRelationDto {
    relationId: string;
    from: ReferenceObjectIdentity;
    to: ReferenceObjectIdentity;
    relationKind: ReferenceRelationKind;
    certainty: ReferenceCertainty;
    content?: ReferenceStatementDto;
    location?: ReferenceStatementLocation;
    reason?: string;
    path: ReferencePathHop[];
    readAction?: ReferenceNextActionDto;
}
/** Compact coverage suitable for an Agent envelope. */
export interface ReferenceSearchCoverageDomainDto {
    domain: string;
    status: ReferenceDomainCoverageDto['status'];
    discoveredSources: number;
    readSuccessSources: number;
    unscannedCount: number;
    failedCount: number;
}
export interface ReferenceSearchCoverageDto {
    scope: string;
    status: ReferenceCoverageDto['status'];
    domains: ReferenceSearchCoverageDomainDto[];
    predicateComplete: boolean;
    negativeConclusionAllowed: boolean;
    /** 本次查询自己的覆盖范围；缺失表示没有查询级覆盖度来源。 */
    queryScope?: ReferenceQueryScopeDto;
}
export interface ReferenceSearchPageDto {
    returnedCount: number;
    hasMore: boolean;
    nextCursor?: string;
    truncationReason?: string;
}
/** Public content-first projection of a ReferencePageRecord. */
export interface ReferenceSearchPage {
    resolution: ReferenceResolution;
    target?: ReferenceObjectIdentity;
    candidates?: ReferenceCandidateDto[];
    relations: ReferenceSearchRelationDto[];
    coverage: ReferenceSearchCoverageDto;
    page: ReferenceSearchPageDto;
    /** 查询级否定结论；inconclusive 时 blockedReasons 写明缺口。 */
    verdict?: 'negative-allowed' | 'inconclusive';
    blockedReasons?: string[];
    caveats?: string[];
    parameterizedEntityArgs?: ReferenceParameterizedCoverageDto;
    scan?: {
        remaining: boolean;
        complete?: boolean;
        failedCount?: number;
        sourceCursor?: string;
        nextAction?: ReferenceNextActionDto;
    };
    nextActions?: ReferenceNextActionDto[];
    diagnostics?: ReferenceDiagnosticDto[];
}
/** The `data.record` payload of a find_references envelope. */
export interface ReferencePageRecord {
    resolution: ReferenceResolution;
    detail?: ReferenceDetail;
    target?: ReferenceObjectIdentity;
    candidates?: ReferenceCandidateDto[];
    targetRead?: ReferenceTargetReadDto;
    context?: ReferenceContextDto;
    relations: ReferenceRelationItem[];
    coverage: ReferenceCoverageDto;
    page: ReferencePageDto;
    /** 查询级否定结论；inconclusive 时 blockedReasons 写明缺口。 */
    verdict?: 'negative-allowed' | 'inconclusive';
    blockedReasons?: string[];
    caveats?: string[];
    parameterizedEntityArgs?: ReferenceParameterizedCoverageDto;
    scan?: {
        remaining: boolean;
        complete?: boolean;
        failedCount?: number;
        sourceCursor?: string;
        nextAction?: ReferenceNextActionDto;
    };
    diagnostics: ReferenceDiagnosticDto[];
    nextActions: ReferenceNextActionDto[];
}
