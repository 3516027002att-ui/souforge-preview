import type { KnowledgeGeneration, KnowledgePage, KnowledgePatch, KnowledgeSourceRef } from './knowledgeTypes.js';
export interface KnowledgeStoreSnapshot {
    schemaVersion: string;
    current: string;
    generations: KnowledgeGeneration[];
    blobs: Record<string, string>;
}
export interface KnowledgeStorePersistence {
    /** Synchronous on purpose: commitPatch is a CAS boundary and must be atomic. */
    load(): KnowledgeStoreSnapshot | null;
    save(snapshot: KnowledgeStoreSnapshot): void;
}
export interface KnowledgeStoreOptions {
    schemaVersion?: string;
    persistence?: KnowledgeStorePersistence;
}
export declare class KnowledgeStore {
    private readonly generations;
    private blobs;
    private current;
    private readonly persistence;
    private readonly schemaVersion;
    constructor(schemaVersionOrOptions?: string | KnowledgeStoreOptions, persistence?: KnowledgeStorePersistence);
    get currentGeneration(): string;
    getCurrent(): KnowledgeGeneration;
    readPage(pageId: string, generationId?: string): KnowledgePage | undefined;
    readBlob(hash: string): string | undefined;
    registerBlob(body: string): string;
    commitPatch(patch: KnowledgePatch): {
        ok: true;
        generation: KnowledgeGeneration;
    } | {
        ok: false;
        code: 'CAS_CONFLICT' | 'LINT_FAILED' | 'PAGE_CAS_CONFLICT' | 'PERSISTENCE_FAILED';
        message: string;
        findings?: unknown;
    };
    sourceRevision(sourceId: string): string | undefined;
    generation(generationId: string): KnowledgeGeneration | undefined;
    generationsForRecovery(): KnowledgeGeneration[];
    private requireGeneration;
    private snapshot;
    private restore;
}
export declare function makeSourceRef(sourceId: string, body: string, observedVersion?: string, readerSchemaHash?: string): KnowledgeSourceRef;
