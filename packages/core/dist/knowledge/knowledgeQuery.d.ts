import type { KnowledgeClaim, KnowledgePage, KnowledgeQueryOptions } from './knowledgeTypes.js';
import { KnowledgeStore } from './knowledgeStore.js';
export declare function queryKnowledgeClaims(store: KnowledgeStore, query: string, options: KnowledgeQueryOptions): KnowledgeClaim[];
export declare function readKnowledgePage(store: KnowledgeStore, pageId: string, options: KnowledgeQueryOptions): KnowledgePage | undefined;
