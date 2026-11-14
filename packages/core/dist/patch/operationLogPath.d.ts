/**
 * Build a Windows-safe file name for a workspace operation log.
 * Workspace ids are typically file:// URLs from makeWorkspaceId; those contain
 * ":" and "/" which cannot be used as a path segment on Windows.
 */
export declare function operationLogFileNameForWorkspace(workspaceId: string): string;
/**
 * Resolve the full store path under a logs directory (e.g. userData/operation-logs).
 * This is the shipped path builder used by desktop main and covered by persist smoke.
 */
export declare function resolveOperationLogStorePath(logsDirectory: string, workspaceId: string): string;
