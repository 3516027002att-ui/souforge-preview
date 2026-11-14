import type { SqliteDatabase } from '../storage/sqliteDatabase.js';
import type { KnowledgeStorePersistence, KnowledgeStoreSnapshot } from './knowledgeStore.js';
export interface SqliteKnowledgeStoreOptions {
    workspaceId: string;
    /** Used only to establish the internal workspace row required by the FK. */
    rootPath?: string;
    game?: string;
    /** Utility snapshot reads must not rewrite workspace metadata from RPC input. */
    ensureWorkspaceRow?: boolean;
}
/**
 * Durable adapter for the curator-only KnowledgeStore.
 *
 * It deliberately stores JSON payloads behind a workspace/generation key. The
 * adapter never receives a Mod writer or a resource path, and every save is one
 * SQLite transaction so CURRENT cannot point at a half-written generation.
 */
export declare class SqliteKnowledgeStorePersistence implements KnowledgeStorePersistence {
    readonly workspaceId: string;
    private readonly database;
    constructor(database: SqliteDatabase, options: SqliteKnowledgeStoreOptions);
    load(): KnowledgeStoreSnapshot | null;
    save(snapshot: KnowledgeStoreSnapshot): void;
}
