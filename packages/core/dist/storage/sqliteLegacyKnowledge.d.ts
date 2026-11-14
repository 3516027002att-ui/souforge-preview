import type { SqliteDatabase } from './sqliteDatabase.js';
import type { SqlMigration } from './sqliteSchema.js';
/** e32edad11a4d7cd493312bf49543d0241b667a42 stored whole snapshots in v14.
 * This is a data conversion, NOT a checksum reanchor. Unknown variants stay closed.
 */
export declare function isLegacyKnowledgeMigration(migration: SqlMigration, name: string, from: string, to: string): boolean;
/** Caller holds IMMEDIATE transaction and has already preserved a consistent backup. */
export declare function convertLegacyKnowledge(database: SqliteDatabase, migration: SqlMigration): void;
