import BetterSqlite3 from 'better-sqlite3';
import type { SqlMigration } from './sqliteSchema.js';
export type SqliteDatabase = BetterSqlite3.Database;
export interface OpenSoulForgeDatabaseOptions {
    busyTimeoutMs?: number;
    readonly?: boolean;
    fileMustExist?: boolean;
    /** Explicit native addon for runtimes whose ABI differs from the host Node.js. */
    nativeBinding?: string;
}
export declare class SqliteMigrationError extends Error {
    readonly code: string;
    readonly details?: unknown | undefined;
    constructor(code: string, message: string, details?: unknown | undefined);
}
export declare function openWorkspaceDatabase(databasePath: string, options?: OpenSoulForgeDatabaseOptions): SqliteDatabase;
export declare function openAppDatabase(databasePath: string, options?: OpenSoulForgeDatabaseOptions): SqliteDatabase;
export declare function openMigratedDatabase(databasePath: string, migrations: readonly SqlMigration[], options?: OpenSoulForgeDatabaseOptions): SqliteDatabase;
export declare function applyMigrations(database: SqliteDatabase, migrations: readonly SqlMigration[]): void;
/**
 * checksum 重锚白名单。
 *
 * ── 为什么需要它 ──
 *
 * 本机实测(2026-08-09):用户打开工作区时报
 * `SQLITE_SCHEMA_NEWER_THAN_APPLICATION`。根因是 `app.db` 的
 * `schema_migrations` 里有 id 2(`v0_5_app_ai_authority_and_retention`),
 * 而代码里 `APP_DB_MIGRATIONS` 只到 id 1 —— 那条迁移曾存在于开发中途、
 * 后来被整条删掉,却没考虑已有数据库仍记着 `user_version = 2`。
 *
 * 把迁移补回代码能解决版本判定,但账本里那条记着旧 checksum
 * (`8355ad4c…`),而补回的 SQL 算出的是新值,于是撞上 checksum 比对。
 *
 * ── 为什么白名单而不是放宽比对 ──
 *
 * checksum 比对守的是「同一个 id 的迁移内容被改过」这件事,那是真实风险:
 * 两台机器跑同一 id 却得到不同 schema。放宽成「名字相同就放过」会把这道
 * 保护整体拆掉。
 *
 * 所以重锚必须逐条登记:id、name、**旧 checksum**、**新 checksum** 四项全中
 * 才放行。旧 checksum 也要匹配,意味着它只认「那一个具体的历史状态」——
 * 任何其他内容漂移仍然报错。补回的 SQL 一旦再改动,新 checksum 就不再等于
 * 登记值,这条重锚随即失效,不会变成长期后门。
 *
 * 重锚只改账本里的 checksum,**不重跑 SQL**:那些表在既有库里已经存在,
 * 重跑 `ALTER TABLE ADD COLUMN` 会因列已存在而失败。
 */
interface ChecksumReanchor {
    id: number;
    name: string;
    /** 账本里记录的历史 checksum。 */
    fromChecksum: string;
    /** 代码当前算出的 checksum。两者都必须匹配才放行。 */
    toChecksum: string;
    reason: string;
}
export declare const CHECKSUM_REANCHORS: readonly ChecksumReanchor[];
export declare function migrationChecksum(migration: SqlMigration): string;
export declare function assertDatabaseIntegrity(database: SqliteDatabase): void;
export interface WorkspaceDatabaseBackupOptions {
    nativeBinding?: string;
    signal?: AbortSignal;
    /** SQLite page progress, also usable to yield a bounded backup page count. */
    progress?: (progress: {
        totalPages: number;
        remainingPages: number;
    }) => number | undefined;
}
/** Publish a SQLite-consistent snapshot without ever replacing an established destination. */
export declare function backupWorkspaceDatabase(sourcePath: string, destinationPath: string, options?: WorkspaceDatabaseBackupOptions): Promise<{
    status: 'migrated' | 'existing';
}>;
export {};
