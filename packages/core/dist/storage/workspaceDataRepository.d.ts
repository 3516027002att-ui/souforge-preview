import type { Diagnostic, IndexedFile, RagChunk, ReferenceEdge, ResourceKind, SymbolBundle } from '@soulforge/shared';
import type { SqliteDatabase } from './sqliteDatabase.js';
export interface PersistedDiagnostic extends Diagnostic {
    id: string;
    workspaceId: string;
    createdAt: string;
    suppressed: boolean;
    resolvedByOpId?: string;
}
/**
 * Bounded, identity-free diagnostics for one successful RAG delta transaction.
 * These counts deliberately contain no chunk IDs, text, or paths so the
 * desktop refresh receipt can distinguish provenance churn from searchable
 * content work without copying the corpus across the utility boundary.
 */
export interface RagChunkDeltaStats {
    finalUpserts: number;
    newUpserts: number;
    bodyChangedUpserts: number;
    metadataOnlyUpserts: number;
    ftsRebuilds: number;
    embeddingDeletes: number;
}
/** Validate the bounded result crossing the desktop utility boundary. */
export declare function isRagChunkDeltaStats(value: unknown): value is RagChunkDeltaStats;
export type BackgroundJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface BackgroundJobRecord {
    jobId: string;
    workspaceId: string;
    title: string;
    jobKind: string;
    status: BackgroundJobStatus;
    progress: {
        current: number;
        total?: number;
        message?: string;
    };
    payload: unknown;
    result?: unknown;
    error?: unknown;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    updatedAt: string;
}
export declare class WorkspaceDataRepository {
    private readonly database;
    readonly workspaceId: string;
    constructor(database: SqliteDatabase, workspaceId: string);
    replaceFiles(files: readonly IndexedFile[]): void;
    searchFiles(query: string, limit?: number): IndexedFile[];
    replaceDiagnostics(diagnostics: readonly Omit<PersistedDiagnostic, 'workspaceId'>[]): void;
    listDiagnostics(): PersistedDiagnostic[];
    upsertJob(job: Omit<BackgroundJobRecord, 'workspaceId'>): void;
    listJobs(): BackgroundJobRecord[];
    createDiagnostic(input: Omit<PersistedDiagnostic, 'id' | 'workspaceId'>): PersistedDiagnostic;
    replaceRagChunks(chunks: readonly RagChunk[]): void;
    /**
     * Incrementally converge the RAG corpus.
     *
     * The previous implementation deleted every chunk and rebuilt both FTS
     * tables after every native read.  That made a parallel read batch turn
     * into repeated full-table writes.  The caller still supplies the complete
     * desired corpus, but only changed/new/deleted chunks touch SQLite.
     */
    mergeRagChunks(chunks: readonly RagChunk[]): void;
    /**
     * Apply one bounded source delta.  The desktop scheduler sends multiple
     * calls when a source has more than MAX_RAG_DELTA_BATCH changes, allowing it
     * to cancel between calls instead of holding one giant synchronous SQLite
     * transaction.
     */
    mergeRagChunkDelta(input: {
        sourceUri: string;
        upserts: readonly RagChunk[];
        deletedChunkIds: readonly string[];
    }): RagChunkDeltaStats;
    loadRagChunks(): RagChunk[];
    searchRagChunks(query: string, limit?: number): RagChunk[];
    /**
     * 兼容旧调用方的整体替换入口。新的内部 embedding 管理器使用下面的
     * mergeRagEmbeddings，按内容指纹做增量更新，不会因一个源变化重写全库。
     */
    replaceRagEmbeddings(entries: Array<{
        chunkId: string;
        model: string;
        vector: Float32Array;
        contentHash?: string;
    }>): void;
    /** 只写入已变化的向量，并删除已失效的 chunk。 */
    mergeRagEmbeddings(input: {
        model: string;
        entries: Array<{
            chunkId: string;
            contentHash: string;
            vector: Float32Array;
        }>;
        deletedChunkIds: readonly string[];
    }): void;
    /**
     * 加载该 workspace 的 chunk 向量（chunkId → Float32Array）。model 是生成
     * 向量所用的 embedding 模型 —— 查询向量必须用同一模型，调用方自行比对。
     */
    loadRagEmbeddings(): Map<string, Float32Array>;
    loadRagEmbeddingRecords(): Array<{
        chunkId: string;
        model: string;
        contentHash: string | null;
        vector: Float32Array;
    }>;
    /** 该 workspace 是否已有向量索引，以及所用 embedding 模型名。 */
    ragEmbeddingModel(): string | null;
    replaceReferences(references: readonly ReferenceEdge[]): void;
    loadReferences(): ReferenceEdge[];
    getSemanticFileCache(relativePath: string, fileSha256: string): SymbolBundle | null;
    getSemanticFileCacheRow(relativePath: string): {
        relativePath: string;
        fileSha256: string;
        resourceKind: string;
        payloadJson: string;
        mtimeMs: number;
        updatedAt: string;
    } | null;
    getAllSemanticFileCacheRows(): Array<{
        relativePath: string;
        fileSha256: string;
        resourceKind: string;
        payloadJson: string;
        mtimeMs: number;
        updatedAt: string;
    }>;
    getAllSemanticFileCache(): Map<string, {
        fileSha256: string;
        payload: SymbolBundle;
    }>;
    upsertSemanticFileCacheRow(entry: {
        relativePath: string;
        fileSha256: string;
        resourceKind: string;
        payloadJson: string;
        mtimeMs: number;
    }): void;
    upsertSemanticFileCache(entry: {
        relativePath: string;
        fileSha256: string;
        resourceKind: ResourceKind;
        payload: SymbolBundle;
        mtimeMs: number;
    }): void;
    deleteSemanticFileCache(relativePaths: readonly string[]): void;
    private assertWorkspace;
}
