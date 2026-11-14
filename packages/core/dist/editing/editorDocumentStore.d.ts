/**
 * DOCSTORE-04: owner-bound 编辑器文档仓库（§14.4 六签名闭合契约）。
 *
 * renderer 发送逻辑引用，main 从 trusted sender/session 推导 ownerKey 后调用
 * 本仓库。ownerKey、绝对路径与 locator 永远不出 main/core：本模块持有完整
 * NativeDocumentLocator（含 outerSourceUri），renderer 只拿 opaque
 * documentHandle。
 *
 * 数据与写链不在本模块：分页/内容由注入的 EditorDocumentDataSource 提供，
 * mutation 由注入的 EditorMutationApplyPort 执行（生产实现是 Patch Engine
 * 写链，smoke 用确定性桩）。本模块只负责 ownership、revision、TTL、能力与
 * bounded page 的裁定。
 */
import type { ApplyEditorMutationRequest, ApplyEditorMutationValue, EditorContentQuery, EditorContentValue, EditorDocumentPageValue, EditorDocumentResult, EditorMutation, EditorPageItemDto, EditorPageQuery, OpenEditorDocumentValue, ReadEditorContentRequest } from '@soulforge/shared';
import type { NativeDocumentLocator } from './nativeDocumentLocator.js';
export interface EditorDocumentStoreContract {
    open(ownerKey: string, locator: NativeDocumentLocator): Promise<EditorDocumentResult<OpenEditorDocumentValue>>;
    get(ownerKey: string, documentHandle: string): Promise<EditorDocumentResult<OpenEditorDocumentValue>>;
    page(ownerKey: string, request: PageEditorDocumentRequestLike): Promise<EditorDocumentResult<EditorDocumentPageValue>>;
    readContent(ownerKey: string, request: ReadEditorContentRequest): Promise<EditorDocumentResult<EditorContentValue>>;
    apply(ownerKey: string, request: ApplyEditorMutationRequest): Promise<EditorDocumentResult<ApplyEditorMutationValue>>;
    close(ownerKey: string, documentHandle: string): Promise<EditorDocumentResult<{
        closed: true;
    }>>;
}
/** §14.4 PageEditorDocumentRequest 的 core-internal 形态（shared DTO 已解码）。 */
export interface PageEditorDocumentRequestLike {
    readonly documentHandle: string;
    readonly expectedRevision: string;
    readonly query: EditorPageQuery;
    readonly cursor: string | null;
    readonly limit: number;
}
export interface EditorDocumentDataSource {
    /**
     * 加载一页。返回 items=null 表示该 query kind 没有数据源（capability
     * 未接通），与「空页」区分：空页是 items=[]。
     */
    loadPage(query: EditorPageQuery, cursor: string | null, limit: number): Promise<{
        items: readonly EditorPageItemDto[] | null;
        nextCursor: string | null;
        totalKnown: number | null;
    }>;
    readContent(query: EditorContentQuery): Promise<EditorContentValue | null>;
}
export type EditorMutationApplyOutcome = {
    kind: 'committed';
    operationId: string;
} | {
    kind: 'cancelled';
} | {
    kind: 'rejected';
    code: string;
};
export interface EditorMutationApplyPort {
    apply(mutation: EditorMutation): Promise<EditorMutationApplyOutcome>;
}
export interface EditorDocumentStoreOptions {
    readonly ttlMs?: number;
    readonly now?: () => number;
    readonly dataSource: EditorDocumentDataSource;
    readonly applyPort: EditorMutationApplyPort;
}
export declare class EditorDocumentStore implements EditorDocumentStoreContract {
    private readonly documents;
    /** Same snapshot/query reads share one data-source call. */
    private readonly pageFlights;
    private readonly contentFlights;
    private readonly ttlMs;
    private readonly now;
    private readonly dataSource;
    private readonly applyPort;
    constructor(options: EditorDocumentStoreOptions);
    private revisionOf;
    private toOpenValue;
    private resolve;
    private isCurrent;
    private pageFlightKey;
    private loadPageOnce;
    private readContentOnce;
    open(ownerKey: string, locator: NativeDocumentLocator): Promise<EditorDocumentResult<OpenEditorDocumentValue>>;
    get(ownerKey: string, documentHandle: string): Promise<EditorDocumentResult<OpenEditorDocumentValue>>;
    page(ownerKey: string, request: PageEditorDocumentRequestLike): Promise<EditorDocumentResult<EditorDocumentPageValue>>;
    readContent(ownerKey: string, request: ReadEditorContentRequest): Promise<EditorDocumentResult<EditorContentValue>>;
    apply(ownerKey: string, request: ApplyEditorMutationRequest): Promise<EditorDocumentResult<ApplyEditorMutationValue>>;
    close(ownerKey: string, documentHandle: string): Promise<EditorDocumentResult<{
        closed: true;
    }>>;
}
