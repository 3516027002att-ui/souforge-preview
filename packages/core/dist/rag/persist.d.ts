import type { RagChunk, RagCorpus, ReferenceEdge } from '@soulforge/shared';
import type { WorkspaceDataRepository } from '../storage/workspaceDataRepository.js';
export interface RagChunkDelta {
    sourceUri: string;
    upserts: RagChunk[];
    deletedChunkIds: string[];
}
/**
 * Compare two corpora by native source.  The desktop persistence path uses
 * this to send only changed rows instead of the complete workspace corpus.
 */
export declare function diffRagCorpusBySource(previous: RagCorpus | null | undefined, next: RagCorpus): RagChunkDelta[];
export declare function persistRagCorpus(repository: WorkspaceDataRepository, corpus: RagCorpus): void;
/** Reference rows are loaded from SQLite in a stable sort order, while the
 * in-memory WorkspaceIndex preserves discovery order.  Compare by content so
 * an unchanged graph does not trigger a full reference-table replacement on
 * every semantic refresh. */
export declare function sameRagReferences(left: readonly ReferenceEdge[], right: readonly ReferenceEdge[]): boolean;
export declare function loadRagCorpus(repository: WorkspaceDataRepository, workspaceId: string): RagCorpus;
