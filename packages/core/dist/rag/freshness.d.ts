import type { RagCorpus } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { type RagChunkExclusionMask } from './retrieve.js';
export declare function getRagStaleChunkIdsCached(index: WorkspaceIndex, corpus: RagCorpus): readonly string[];
export declare function getRagStaleChunkMaskCached(index: WorkspaceIndex, corpus: RagCorpus): RagChunkExclusionMask | undefined;
