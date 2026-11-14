import { asRecord, fail, ok } from '../toolRegistrySupport.js';
import { getDefaultOperationLogStore } from '../../patch/operationLog.js';
import { projectOperationReceipt, projectPatchHistoryEntry } from '../operationReceipt.js';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** list_operations: one domain tool declaration, schema and handler. */
export function createListOperationsTool() {
    return {
        name: 'list_operations',
        description: 'List Patch Engine operation log / patch history entries for the active workspace as logical receipts: opId, status, hashes and logical source URIs. Machine paths and backup locations stay in the local audit log and are not returned. Returns the newest page by default: the whole log grows without bound and used to exceed the delivery budget, which handed back an empty record and left no way to page it.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: { limit: 'safe-integer?', offset: 'safe-integer?', includeHistory: 'boolean?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const requestedLimit = typeof value.limit === 'number' && Number.isSafeInteger(value.limit) ? value.limit : DEFAULT_LIMIT;
            const limit = Math.max(1, Math.min(MAX_LIMIT, requestedLimit));
            const offset = typeof value.offset === 'number' && Number.isSafeInteger(value.offset) && value.offset > 0 ? value.offset : 0;
            // 优先用主进程注入的生产 SQLite store；没有注入时退回内存 store（测试/离线
            // 形态），不再把「内存空日志」冒充生产日志 —— 主进程 ai.runAgent 已注入。
            const store = context.operationLogStore ?? getDefaultOperationLogStore();
            const operations = await store.list(ws.workspaceId);
            const page = operations.slice(offset, offset + limit);
            const nextOffset = offset + page.length < operations.length ? offset + page.length : undefined;
            const includeHistory = value.includeHistory === true;
            const history = includeHistory ? await store.history(ws.workspaceId) : undefined;
            return ok({
                operations: page.map(projectOperationReceipt),
                total: operations.length,
                offset,
                limit,
                hasMore: nextOffset !== undefined,
                ...(nextOffset !== undefined ? { nextOffset } : {}),
                ...(history !== undefined ? {
                    history: history.slice(offset, offset + limit).map(projectPatchHistoryEntry),
                    historyTotal: history.length
                } : {}),
                note: history === undefined
                    ? `默认只返回最近 ${limit} 条操作；用 offset/nextOffset 继续翻页，需要 patch 历史时传 includeHistory=true。`
                    : `操作与 patch 历史各返回 ${limit} 条；用 offset/nextOffset 继续翻页。`
            });
        }
    };
}
//# sourceMappingURL=list_operations.js.map