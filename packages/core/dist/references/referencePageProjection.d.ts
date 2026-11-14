/**
 * 关联页投影 + envelope 预算（T08，执行指令 §T08 步骤 6-8、最终投影 1-7）。
 *
 * 职责：
 * - 把 provider 的 ReferenceEdge（confidence 词表）投影成对外的
 *   ReferenceRelationItem（certainty 词表 confirmed/indirect/hypothesis），
 *   补齐真实语句、位置与完整身份；不能解析的位置保留诊断，不编造摘要句。
 * - 稳定排序：确定关系优先，来源类型与完整身份作为次级键（步骤 6）。
 * - envelope 预算：对外序列化走 content-first projection，不把 evidence、版本或
 *   hash 带进页面；缩页只整条移除 relation，长 source snippet 显式 truncated 并
 *   提供 readAction，identity/path 保持完整。单条装不下时保留诊断（投影 6）。
 */
import type { ReferenceCoverageDto, ReferenceEvidenceDto, ReferenceContextDto, ReferenceObjectIdentity, ReferencePageRecord, ReferenceParameterizedCoverageDto, ReferenceRelationItem, ReferenceSearchPage, ReferenceSourceVersionDto, ReferenceStatementDto, ReferenceTargetReadDto, SymbolBundle } from '@soulforge/shared';
import type { QueryScopeDomainCoverage } from './queryScopedNegativeConclusion.js';
import type { ReferenceEdge } from '@soulforge/shared';
import { type DependencySummary } from '../runtime/resourceVersion.js';
export declare const REFERENCE_ENVELOPE_MAX_BYTES = 8192;
export declare const REFERENCE_ENVELOPE_MAX_CHARS = 8192;
export declare const REFERENCE_CONTENT_STATEMENT_MAX_CHARS = 512;
/** Fixed-length reservation so replacing it with a host cursor cannot evict a relation. */
export declare const REFERENCE_CURSOR_TOKEN_PLACEHOLDER: string;
/** Serialize the public content page — the single Agent envelope budget callback. */
export declare function serializeReferenceEnvelope(record: ReferencePageRecord): string;
/**
 * Confidence (internal graph) → certainty (external contract). High edges are
 * confirmed direct relations; medium edges are indirect (path/binding or
 * cross-scope); low edges are hypotheses. Never re-derives semantics — pure
 * vocabulary mapping so a name-inference edge can never surface as confirmed.
 */
export declare function certaintyForEdge(edge: ReferenceEdge, indirect: boolean): 'confirmed' | 'indirect' | 'hypothesis';
/**
 * The edge reason already names the rule for hypotheses
 * (`hypothesis(<rule>):`); surface it as ruleName, required by the DTO.
 */
export declare function ruleNameFromReason(reason: string): string | undefined;
export declare function statementFromEdge(edge: ReferenceEdge): ReferenceStatementDto | undefined;
export declare function evidenceDtoFromEdge(edge: ReferenceEdge, versions: Map<string, ReferenceSourceVersionDto>): ReferenceEvidenceDto[];
/**
 * Build a stable identity for a uri using the bundle's symbol tables. Falls
 * back to a uri-derived identity; never invents row/event ids.
 */
export declare function identityForUri(uri: string, bundle: SymbolBundle, workspaceId: string): ReferenceObjectIdentity;
export declare function sourceVersionFromSymbol(symbol: {
    sourceUri: string;
    outerFileHash?: string;
    sourceHash?: string;
    sourceRevision?: number;
}): ReferenceSourceVersionDto;
/** Collect every source's version facts from the bundle for evidence stamping. */
export declare function collectSourceVersions(bundle: SymbolBundle): Map<string, ReferenceSourceVersionDto>;
export interface AssembleRelationsInput {
    edges: readonly ReferenceEdge[];
    bundle: SymbolBundle;
    workspaceId: string;
    versions: Map<string, ReferenceSourceVersionDto>;
    /** uris reached through a bounded call-chain hop (T05) → indirect certainty. */
    indirectEdgeKeys?: Set<string>;
    /** Complete root-to-edge traversal paths keyed by the edge identity. */
    paths?: ReadonlyMap<string, import('@soulforge/shared').ReferencePathHop[]>;
}
export declare function edgeIdentityKey(fromUri: string, toUri: string, kind: ReferenceEdge['kind'], evidenceSourceUri?: string): string;
export declare function edgeKey(edge: ReferenceEdge): string;
export declare function assembleRelations(input: AssembleRelationsInput): ReferenceRelationItem[];
export interface CoverageInput {
    bundle: SymbolBundle;
    /** Source URIs actually visited by the providers in this query. */
    scannedDomains: readonly string[];
    truncated: boolean;
    /** Optional host-owned coverage certificate. Never infer completeness from the bundle alone. */
    coverageStates?: readonly {
        domain?: string;
        status?: string;
        coveredResources?: number;
        expectedResources?: number | null;
        coveredResourceIds?: readonly string[];
        expectedResourceIds?: readonly string[] | null;
        staleSources?: readonly string[];
        diagnostics?: readonly string[];
    }[] | undefined;
}
export declare function buildCoverage(input: CoverageInput): ReferenceCoverageDto;
/** 查询级否定结论（来自 `buildQueryScopedNegativeConclusion`）。 */
export interface ReferenceQueryConclusion {
    verdict: 'negative-allowed' | 'inconclusive';
    negativeConclusionAllowed: boolean;
    blockedReasons: string[];
    caveats: string[];
    domains: readonly string[];
    complete: boolean;
    /** 逐来源域计数；让同域查询给出该域的 totalSources，而不是整库文件数。 */
    sources?: readonly QueryScopeDomainCoverage[];
    parameterized?: ReferenceParameterizedCoverageDto;
}
/**
 * 把查询级否定结论写到关联页上。coverage 里的 `negativeConclusionAllowed`
 * 只由这里给出的结论决定；调用方必须传查询级来源，不能传整体完整性。
 */
export declare function applyReferenceQueryConclusion(record: ReferencePageRecord, conclusion: ReferenceQueryConclusion): ReferencePageRecord;
export declare function buildDependencySummary(bundle: SymbolBundle, catalogGeneration?: number): DependencySummary;
export interface BuildPageInput {
    record: Omit<ReferencePageRecord, 'page'>;
    limit: number;
    offset: number;
    /** Build context from the relations actually retained on this page. */
    contextForPage?: (relations: ReferenceRelationItem[]) => ReferenceContextDto | undefined;
    /** Reserve the final opaque cursor's byte length while budgeting this page. */
    nextCursorPlaceholder?: string;
    truncationReason?: string;
}
export interface BuiltPage {
    record: ReferencePageRecord;
    droppedRelationIds: string[];
    tooLargeRelationId?: string;
}
/**
 * Paginate + envelope-budget the page. Shrinks by removing WHOLE relation
 * items (never truncating a statement/hash). Removed items continue on the
 * next page via nextCursor. A single item that cannot fit even alone yields
 * REFERENCE_PAGE_ITEM_TOO_LARGE instead of a fake ok=true empty record.
 */
export declare function buildBoundedPage(input: BuildPageInput): BuiltPage;
export interface ReferenceSearchPageProjectionOptions {
    maxBytes?: number;
    maxChars?: number;
}
/**
 * Project a host-side record to the content-first page consumed by Agent and
 * renderer envelopes.  Evidence, source versions and hashes never cross this
 * boundary.  Long statements are explicitly marked and carry a read action;
 * identity fields and paths are kept intact.
 */
export declare function projectReferenceSearchPage(record: ReferencePageRecord, options?: ReferenceSearchPageProjectionOptions): ReferenceSearchPage;
export declare function encodeCursor(offset: number, sourceOffset?: number): string;
export interface DecodedCursor {
    offset: number;
    sourceOffset?: number;
}
export declare function decodeCursor(cursor: string): DecodedCursor | undefined;
export declare function emptyTargetRead(): ReferenceTargetReadDto;
