export interface SqlMigration {
    id: number;
    name: string;
    sql: string;
    /**
     * 需要按「列不存在才加」语义添加的列。
     *
     * SQLite 没有 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，而迁移可能运行在
     * 已经有该列的既有库上（本仓库实测遇到过：一条迁移被删后重建，既有库里它
     * 加的列已存在，裸 ALTER 报 duplicate column）。执行器逐列检查后再决定。
     *
     * checksum 计算包含本字段，故改动它会改变 checksum —— 这是有意的：
     * 它和 sql 一样是迁移内容的一部分。
     */
    addColumns?: ReadonlyArray<{
        table: string;
        column: string;
        definition: string;
    }>;
    /**
     * 在 addColumns 之后执行的 SQL。
     *
     * 用于依赖新列的对象（如建在新列上的索引）：那些语句不能与主 sql 同批执行，
     * 因为主 sql 跑在加列之前。
     */
    sqlAfterColumns?: string;
    /** Preserve a consistent database snapshot before destructive upgrade. */
    requiresBackup?: boolean;
}
/**
 * SQLite schema for SoulForge's persistent evidence index.
 *
 * This file intentionally has no SQLite driver dependency. The desktop main
 * process can apply these migrations with better-sqlite3, node:sqlite, or any
 * future adapter while core query semantics remain stable.
 */
export declare const SQLITE_MIGRATIONS: readonly SqlMigration[];
export declare const APP_DB_MIGRATIONS: readonly SqlMigration[];
export declare function getLatestSchemaVersion(): number;
export declare function getLatestAppSchemaVersion(): number;
export declare function splitSqlStatements(sql: string): string[];
