/**
 * 有界原生内容补充层（只读）。
 *
 * 初始工作区索引可能只有目录/outline，或 export-event 的 instruction
 * args 为空。本模块把一次关联查询需要的事件、脚本和 PARAM 字段按来源分批
 * 补齐，再交回同一个 WorkspaceIndex；它不写 Mod、不执行脚本，也不维护第二
 * 套原生格式 parser。事件仍由 Bridge 读取，参数布局仍由 first-party EMEDF
 * 和 PARAM metadata 解释。
 */
import type { Diagnostic, EmevdEditorDocument, EventExport, IndexedFile } from '@soulforge/shared';
import { type EmedfRegistry } from '../emevd/emedfSchema.js';
import { type ReadFullEmevdDocumentResult } from '../editing/emevdFullDocument.js';
import { type LuabndListResult, type LuabndReadResult } from '../editing/luabndEdit.js';
import { refreshNativeSemanticSources } from '../indexing/nativeSemanticRefresh.js';
import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import type { DiagnosticEvent } from '../diagnostics/diagnosticEvent.js';
export type { ScriptLiteralTargetIndexes } from './scriptReferenceProvider.js';
export declare const NATIVE_REFERENCE_CURSOR_VERSION = 1;
export interface NativeReferenceContentCursor {
    version: 1;
    eventOffset: number;
    scriptOffset: number;
    paramOffset: number;
    completedSourceKeys?: string[];
    failedSourceKeys?: string[];
    scriptChildOffsets?: Record<string, number>;
}
export interface NativeReferenceEditPort {
    stagingRoot: string;
    allowedRoots(): string[];
    oodleRuntimeRoot?: string;
}
export interface NativeEventReadRequest {
    file: IndexedFile;
    edit?: NativeReferenceEditPort;
    registry: EmedfRegistry;
    timeoutMs: number | undefined;
    signal: AbortSignal | undefined;
}
export type NativeEventReader = (input: NativeEventReadRequest) => Promise<ReadFullEmevdDocumentResult>;
export interface NativeScriptListRequest {
    file: IndexedFile;
    edit: NativeReferenceEditPort;
    timeoutMs: number | undefined;
    signal: AbortSignal | undefined;
}
export interface NativeScriptReadRequest extends NativeScriptListRequest {
    childPath: string;
    expectedContainerHash?: string;
    expectedChildHash?: string;
}
export type NativeScriptListReader = (input: NativeScriptListRequest) => Promise<LuabndListResult>;
export type NativeScriptReader = (input: NativeScriptReadRequest) => Promise<LuabndReadResult>;
export interface NativeReferenceSourceVersion {
    domain: 'event' | 'script' | 'param';
    sourceUri: string;
    sourceHash?: string;
    outerFileHash?: string;
    childHash?: string;
    childPath?: string;
    sourceRevision?: number;
}
export interface NativeReferenceContentOptions {
    index: WorkspaceIndex;
    /** Native edit session/port used only for read roots and staging. */
    edit?: NativeReferenceEditPort;
    /** Restrict the scan to caller-selected files; defaults to index catalog. */
    sourceFiles?: readonly IndexedFile[];
    /** Sources directly involved in the current target/query are scanned first. */
    prioritySourceUris?: readonly string[];
    /** Optional target URI; its source portion is added to prioritySourceUris. */
    targetUri?: string;
    cursor?: NativeReferenceContentCursor;
    /** Alias used by find_references source-scan continuation payloads. */
    sourceCursor?: NativeReferenceContentCursor;
    signal?: AbortSignal;
    timeoutMs?: number;
    /** Per-domain native source cap for one invocation. */
    maxSources?: number;
    /**
     * Restrict the scan to these source domains. A same-domain query only needs
     * its own domain, and spending the bounded read budget on unrelated EMEVD /
     * script sources both slows it down and still cannot complete them.
     * Omitted = every domain.
     */
    domains?: readonly ('event' | 'param' | 'script')[];
    /**
     * Per-domain override of `maxSources`. A same-domain query only cares about
     * its own domain, so it can read that domain completely in one call while
     * unrelated domains keep the small default budget.
     */
    maxSourcesByDomain?: Partial<Record<'event' | 'param' | 'script', number>>;
    /** Maximum script children decoded in one invocation. */
    maxScripts?: number;
    /** Byte budget for decoded script text in one invocation. */
    maxBytes?: number;
    registry?: EmedfRegistry;
    /** PARAM fields are refreshed only when rows lack a field projection. */
    hydrateParamFields?: boolean;
    /** Internal/test seams; production uses Bridge wrappers. */
    eventReader?: NativeEventReader;
    scriptListReader?: NativeScriptListReader;
    scriptReader?: NativeScriptReader;
    paramRefresher?: typeof refreshNativeSemanticSources;
    onDiagnostic?: (event: DiagnosticEvent) => void;
}
export interface NativeReferenceDomainProgress {
    /** Sources this domain owns in the current catalog. */
    total: number;
    /** Sources this invocation finished reading (or found already projected in-session). */
    completed: number;
    failed: number;
}
export interface NativeReferenceContentResult {
    ok: boolean;
    complete: boolean;
    added: number;
    updated: number;
    skipped: number;
    processed: {
        eventSources: number;
        scriptSources: number;
        scriptChildren: number;
        paramSources: number;
        paramRows: number;
    };
    remaining: {
        eventSources: number;
        scriptSources: number;
        scriptChildren: number;
        paramSources: number;
    };
    /** Per-domain source progress over the same source partition the scan owns. */
    domainProgress: Record<'event' | 'param' | 'script', NativeReferenceDomainProgress>;
    nextCursor?: NativeReferenceContentCursor;
    /** Alias for callers that persist scan state under sourceCursor. */
    sourceCursor?: NativeReferenceContentCursor;
    completedSourceKeys: string[];
    failedSourceKeys: string[];
    updatedSourceUris: string[];
    sourceVersions: NativeReferenceSourceVersion[];
    diagnostics: Diagnostic[];
    /** Current projection; root may serialize only updatedSourceUris/sourceVersions. */
    bundle: ReturnType<WorkspaceIndex['toSymbolBundle']>;
}
/**
 * PARAM 行引用的**唯一**来源集合：参数表容器（.parambnd/.param）。
 *
 * `param/drawparam/*.gparam.dcx` 与 param 域同类文件，但 GPARAM 没有参数行，
 * 也不会产生 `references_param_row`。native 引用扫描只用这个集合读源；查询级
 * 覆盖度也必须按同一集合计算，否则 58 个永远读不到的 gparam 会让同域否定结论
 * 永远停在 inconclusive。
 */
export declare function isParamRowSourceFile(file: Pick<IndexedFile, 'resourceKind' | 'relativePath' | 'sourceUri'>): boolean;
/**
 * Enrich the selected native sources and publish only through WorkspaceIndex
 * upsert APIs.  The result is deliberately resumable: offsets are advisory,
 * while source keys contain the current outer hash/revision so a changed file
 * is never skipped by an old cursor.
 */
export declare function enrichReferenceContent(input: NativeReferenceContentOptions): Promise<NativeReferenceContentResult>;
/** Convert a complete native editor document into the index's typed symbols. */
export declare function documentToNativeEventExport(input: {
    sourceUri: string;
    sourceHash?: string;
    outerFileHash?: string;
    sourceRevision?: number;
    document: EmevdEditorDocument;
    registry: EmedfRegistry;
}): EventExport;
