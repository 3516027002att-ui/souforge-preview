import type { KnowledgeClaim, KnowledgePage, KnowledgePatch } from './knowledgeTypes.js';
import { KnowledgeStore } from './knowledgeStore.js';
export interface KnowledgeIngestInput {
    sourceId: string;
    body: string;
    observedVersion: string;
    readerSchemaHash: string;
    page: Omit<KnowledgePage, 'contentHash' | 'revision' | 'claims'> & {
        claims?: KnowledgeClaim[];
    };
}
export declare function buildKnowledgePatch(store: KnowledgeStore, input: KnowledgeIngestInput): KnowledgePatch;
export declare function ingestKnowledgeSource(store: KnowledgeStore, input: KnowledgeIngestInput): ReturnType<KnowledgeStore['commitPatch']>;
export declare function sanitizeKnowledgeText(text: string): string;
