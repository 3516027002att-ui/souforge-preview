import type { AiToolPermissionLevel, IndexedFile, PatchMode, ReferenceEdge, ResourceKind } from '@soulforge/shared';
import type { RagChunkFamily, RagCorpus } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { nativeEditSessionFromContext } from '../editing/nativeEditSession.js';
import { type ParamFieldEdit, type ParamFieldSnapshot } from '../param/containerParamEdit.js';
import { type FmgEntryEdit } from '../editing/fmgEdit.js';
import * as emevdEdit from '../editing/emevdEdit.js';
import { type MsbPartTransformEdit } from '../editing/msbEdit.js';
import { type RagChunkExclusionMask } from '../rag/retrieve.js';
import { type EntityRelationRequest } from './entityResolution.js';
import type { ToolPermission, HostResolvedEmevdEventTarget, KnowledgeSourceChange, ToolContext, ToolResult } from './toolRegistry.js';
export type EmevdEventReadFormat = 'darkscript' | 'json';
export type EmevdEventReadCoreInput = {
    edit: ReturnType<typeof nativeEditSessionFromContext>;
    file: string;
    eventId: number;
    format?: EmevdEventReadFormat;
    instructionOffset?: number;
    instructionLimit?: number;
};
export type EmevdEventReadCoreResult = {
    ok: boolean;
    [key: string]: unknown;
};
export type EmevdEventReadCore = (input: EmevdEventReadCoreInput) => Promise<EmevdEventReadCoreResult>;
export declare function resolveReadEmevdEvent(): EmevdEventReadCore | undefined;
export type NativePostWriteVerification = {
    ok: true;
    details?: unknown;
} | {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
export declare function finalizeCommittedToolResult<T extends object>(input: {
    data: T;
    changedSources: KnowledgeSourceChange;
    context: ToolContext;
    verifyNative?: () => Promise<NativePostWriteVerification>;
    /**
     * Extra proof-store keys to invalidate (e.g. PARAM logical table names the
     * read proof was keyed on, which differ from the container path).
     */
    invalidateProofKeys?: readonly string[];
    /**
     * 只让这些对象键的读证明过期（同一外层源的其它证明保持有效）。
     *
     * 写一个 PARAM 子表只替换那个子项，写一个 TAE 段只替换那个段：把同容器其它子表/段的
     * 读证明一并作废，会让「读 A → 写 B → 写 A」这种正常流程在最后一步无谓失败。
     * 被 scope 覆盖的外层源不再走整片失效。
     */
    invalidateProofScopes?: ReadonlyArray<{
        source: string;
        matches: (objectKey: string) => boolean;
    }>;
}): Promise<ToolResult<T & Record<string, unknown>>>;
/**
 * Map the EMEVD facade result into the registry lifecycle contract. This is
 * kept separate from the native handler so the no-op and post-commit-failure
 * boundaries can be tested without starting a Bridge process.
 */
export declare function finalizeEmevdDslApplyResult(result: emevdEdit.EmevdApplyResult, file: string, context: ToolContext): Promise<ToolResult>;
export declare function verifyCommittedParamFields(input: {
    edit: ReturnType<typeof nativeEditSessionFromContext>;
    edits: readonly ParamFieldEdit[];
    expected: readonly ParamFieldSnapshot[];
    containerPath: string;
}): Promise<NativePostWriteVerification>;
export declare function summarizeReferences(edges: ReferenceEdge[]): {
    high: number;
    medium: number;
    low: number;
    total: number;
};
export declare function normalizePermissionLevel(permission: ToolPermission): AiToolPermissionLevel;
export declare function ok<T>(data: T): ToolResult<T>;
export declare function fail(code: string, message: string, details?: unknown): ToolResult<never>;
export declare function asRecord(value: unknown): Record<string, unknown>;
export declare function asString(value: unknown, fallback?: string): string;
export declare function asOptionalString(value: unknown): string | undefined;
export declare const KNOWLEDGE_SCOPE_PLACEHOLDERS: Set<string>;
export declare function resolveKnowledgeWorkspaceId(requestedValue: unknown, context: ToolContext): {
    ok: true;
    workspaceId: string;
} | {
    ok: false;
    result: ToolResult<never>;
};
export declare function requireEditSession(context: ToolContext, purpose: 'read' | 'write'): {
    ok: true;
    session: ReturnType<typeof nativeEditSessionFromContext>;
} | ToolResult<never>;
export type IndexedFileResolution = {
    ok: true;
    path: string;
    sourceUri: string;
    canonical?: boolean;
} | {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
export type HostResolvedEmevdEventTargetResult = {
    ok: true;
    target: HostResolvedEmevdEventTarget;
} | {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
export declare function resolveHostResolvedEmevdEventTarget(context: ToolContext, input: unknown): HostResolvedEmevdEventTargetResult;
export declare function nativePathFromFileToken(token: string): string;
/**
 * Resolve the model-facing file token against the current workspace catalog.
 * Search results expose a sourceUri, while models commonly pass only a logical
 * map id such as m10_00_00_00. Native readers need the actual indexed file;
 * silently guessing between base/overlay variants would be unsafe, so an
 * ambiguous logical id fails with the available source URIs.
 */
export declare function resolveIndexedResourceFile(context: ToolContext, input: string, resourceKind: ResourceKind): IndexedFileResolution;
export declare function canonicalScriptSourceUri(context: ToolContext, containerPath: string, fallback?: string): string;
export declare function ambiguousIndexedFiles(resourceKind: ResourceKind, token: string, files: readonly IndexedFile[]): IndexedFileResolution;
export declare function normalizeFileToken(value: string): string;
export declare function isLogicalMapToken(value: string): boolean;
export declare function isMapPathToken(value: string): boolean;
export declare function mapIdFromFileToken(value: string): string | null;
export declare function nativeFormatHint(targetUri: string, targetPath: string): string | null;
export declare function asIdList(value: unknown): number[];
export declare function asStringList(value: unknown): string[];
export declare function asEntityRelations(value: unknown): EntityRelationRequest[];
export declare function asParamEdits(value: unknown): {
    ok: true;
    edits: ParamFieldEdit[];
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function asFmgEdits(value: unknown): {
    ok: true;
    edits: FmgEntryEdit[];
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function asTaeTimeEdits(value: unknown): {
    ok: true;
    edits: Array<{
        address: string;
        startFrame?: number;
        endFrame?: number;
    }>;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function asTaeFieldEdits(value: unknown): {
    ok: true;
    edits: Array<{
        address: string;
        fieldIndex?: number;
        fieldName?: string;
        value: string | number | boolean;
    }>;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare const MSB_TRANSFORM_FIELDS: readonly ["posX", "posY", "posZ", "rotX", "rotY", "rotZ", "scaleX", "scaleY", "scaleZ"];
export declare function asMsbTransformEdits(value: unknown): {
    ok: true;
    edits: MsbPartTransformEdit[];
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function asNumber(value: unknown, fallback: number): number;
/**
 * Cursor freshness identity for indexed event search. Hash only stable
 * candidate identity/provenance, not full instruction bodies, so minting or
 * validating a cursor does not recreate the historical Invalid string length
 * failure on large EMEVD bundles.
 */
export declare function eventSearchSnapshotHash(query: string, matches: ReadonlyArray<{
    item: {
        uri: string;
        sourceHash?: string;
        sourceRevision?: number;
    };
    score: number;
}>): string;
export declare function indexedEventSearchCoverage(context: ToolContext, query: string): {
    coverage: {
        scope: string;
        status: string;
        negativeConclusionAllowed: boolean;
        domains: import("../index.js").CoverageState[];
        detail: string;
    };
    nextActions: {
        tool: string;
        args: {
            query: string;
            kinds: string[];
            limit: number;
        };
        reason: string;
    }[];
};
export declare function searchScopedNativeEvents(context: ToolContext, file: string, query: string, limit: number, continuation?: {
    sourceHash: string;
    offset: number;
}): Promise<ToolResult>;
export declare function hashEventSource(file: string, signal?: AbortSignal): Promise<string>;
export declare function nativeEventSearchSnapshotHash(query: string, files: readonly IndexedFile[]): string;
export declare function scriptCatalogSnapshotHash(sourceUri: string, outerFileHash: string, scripts: ReadonlyArray<{
    sanitizedName: string;
    contentHash?: string;
    contentKind: string;
}>): string;
/**
 * CLI invocations are one-shot Node processes, so the in-memory read-session
 * table may not exist when a model feeds a cursor into the next invocation.
 * Recompute the bounded candidate list and accept the opaque offset only when
 * the source snapshot hash and scope still match. Desktop calls continue to
 * use NativeReadSessionManager; this is the restart-safe read-only fallback.
 */
export declare function resolveStatelessCursorPage<T>(payload: {
    sessionId: string;
    offset: number;
    sourceHash: string;
    domain: string;
    scope: string;
}, currentSourceHash: string, items: readonly T[], limit: number, domain: 'emevd' | 'script', scope: string): {
    items: T[];
    offset: number;
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
};
export declare function asResourceKinds(value: unknown): ResourceKind[] | undefined;
export declare function asRagFamilies(value: unknown): RagChunkFamily[] | undefined;
export declare function resolveRagCorpus(context: ToolContext): RagCorpus | null;
/** Normal desktop snapshots are prebuilt; legacy/live-merge fallbacks must not block main. */
export declare function prepareRagQueryLookup(corpus: RagCorpus | null, signal?: AbortSignal): Promise<void>;
export declare function isWorkspaceContextCurrent(context: ToolContext): boolean;
/**
 * A query that lost its letters and digits — typically through a shell pipe that re-encoded it, so
 * "鬼形部" arrived as "???" — searched for nothing and still reported completeness "complete" with
 * zero evidence. That reads as "this object does not exist", which is the most expensive wrong answer
 * a search tool can give. Refuse it and name the cause instead.
 */
export declare function searchQueryUnusable(query: string | undefined): string | undefined;
export declare function ragSearchFallback(context: ToolContext, query: string, families: readonly RagChunkFamily[], limit: number, toolName: string, paramNames?: readonly string[]): Promise<ToolResult<unknown>>;
export declare function buildCatalogFallbackHits(index: WorkspaceIndex | null, query: string, families: readonly RagChunkFamily[], limit: number): Array<Record<string, unknown>>;
export declare function staleRagChunkOption(context: ToolContext, corpus: RagCorpus | null): {
    excludeChunkMask?: RagChunkExclusionMask;
};
export declare function normalizeParamNameForFallback(value: string): string;
export declare function normalizeParamSearchText(value: string): string;
export declare function asReferenceDirection(value: unknown): 'from' | 'to' | 'both';
/** Handler-side normalizer for read_flver.section; an unknown value fails closed. */
export declare function asFlverSection(value: unknown): 'meshes' | 'materials' | 'texture-slots' | 'bones' | '__unaccepted__';
export declare function asPatchMode(value: unknown, fallback: ToolContext['mode']): PatchMode;
/**
 * Handler-side normalizers for every `enum:`-declared field, keyed
 * `toolName.fieldName`. Exported so the schema gate can prove each declared
 * value is actually accepted rather than silently defaulted.
 *
 * A declaration is free to list a value the handler does not accept — that
 * costs nothing at compile time and nothing at runtime, but it makes the model
 * pass a value it believes is legal and receive a different one. Reading the
 * real normalizers (instead of restating the accepted sets in the gate) keeps
 * that check from becoming a second copy that drifts.
 */
export declare const ENUM_FIELD_NORMALIZERS: Record<string, (value: string) => string>;
/** Shared domain implementation; read/search declarations live in separate modules. */
export declare function createStandaloneHksHandler(name: 'read_hks_script' | 'search_hks_script'): import('./toolRegistry.js').RegisteredTool['run'];
/**
 * A diagnostic that echoes unbounded caller input turns one bad call into a huge response: a 50 KB
 * uri came back verbatim in an EVENT_NOT_FOUND message, and 5000 missing part names were listed in
 * full. Clip the echo; the caller already knows what it sent.
 */
export declare function clipForMessage(value: unknown, maxChars?: number): string;
/**
 * Resolve a model-facing file token against the current workspace catalog.
 *
 * Native readers need a host path, while the model usually holds a logical
 * `sourceUri` or a workspace-relative path. An exact token match against the
 * catalog is preferred; an ambiguous match must fail with the candidate list
 * rather than silently picking one. A token the catalog does not know keeps
 * its logical identity only when it is relative: an absolute host path has no
 * workspace form and must not be echoed back as a sourceUri.
 *
 * The container listing and the TPF reader share this rule; keeping one
 * implementation prevents the two from drifting on ambiguity and on the
 * absolute-path case.
 */
export declare function resolveWorkspaceFileToken(context: ToolContext, input: string, options?: {
    ambiguousCode?: string;
    ambiguousMessage?: string;
}): {
    ok: true;
    path: string;
    sourceUri?: string;
} | {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
/** Serialized-byte budget for one model-facing page of native rows. */
export declare const TOOL_ROW_PAGE_BUDGET_BYTES: number;
export interface ToolRowPage<T> {
    rows: T[];
    offset: number;
    limit: number;
    returnedCount: number;
    totalCount: number;
    remainingCount: number;
    hasMore: boolean;
    nextOffset?: number;
    truncated: boolean;
    pagination: {
        offset: number;
        limit: number;
        returnedCount: number;
        totalCount: number;
        remainingCount: number;
        hasMore: boolean;
        nextOffset?: number;
    };
}
/**
 * Page native rows by the serialized size of the page that will actually be
 * sent, not only by row count: one long texture name or one 255-value GPARAM
 * parameter must not push the Agent envelope over its byte limit. An
 * over-budget single row is still returned (a page of zero rows would read as
 * "nothing here"), and `hasMore`/`nextOffset` always describe the rows the
 * Bridge actually returned.
 */
export declare function paginateToolRows<T>(rows: readonly T[], offset: number, limit: number, rowOverheadBytes?: number): ToolRowPage<T>;
