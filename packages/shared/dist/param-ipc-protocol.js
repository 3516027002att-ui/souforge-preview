/**
 * PARAM session IPC 协议（瘦路径，B3）。
 *
 * 权威不变量：
 *  - native authority 在 C# Bridge 的 `ParamDocumentSessionCache`（parse once →
 *    project many）；Electron main 只保存 opaque sessionToken 与轻量绑定元数据，
 *    不缓存完整 native PARAM document。
 *  - PARAM row 的物理身份是「rowIndex + id + dataHash」三元组：PARAM 的 row.id
 *    不保证全表唯一，任何按 id 单值定位行的 API 都是错误设计。
 *  - index 投影永不携带行字节（`ParamIndexRow` 禁止 dataBase64/rawBytes/fields
 *    等载荷字段）；行字节只经 `readRows` 按选中的物理身份返回。
 */
/** Channel source of truth：main/preload 都从这里取，不得各自手写。 */
export const PARAM_SESSION_IPC_CHANNELS = {
    open: 'resource.openParamSession',
    readIndexPage: 'resource.readParamIndexPage',
    readRows: 'resource.readParamRows'
};
/**
 * 单次 selected-row payload 请求的行数上限（B3.6）。仓库此前没有统一的
 * row-payload batch 上限，按施工图定义在此作为跨语言单一来源；C# 侧以行为
 * 验证契约对齐（同一数值）。
 */
export const PARAM_ROW_PAYLOAD_BATCH_MAX = 256;
/** Stable renderer/main key; PARAM id alone is intentionally insufficient. */
export function paramPhysicalRowKey(identity) {
    return JSON.stringify([identity.rowIndex, identity.id, identity.dataHash]);
}
export function createParamSessionMaterializationTracker(rowCount) {
    const normalizedRowCount = Number.isSafeInteger(rowCount) && rowCount >= 0 ? rowCount : 0;
    const indexRows = new Set();
    const payloadRows = new Set();
    let unrequestedPayloadRows = 0;
    return {
        observeIndex(rows) {
            for (const row of rows)
                indexRows.add(row.rowIndex);
        },
        observePayload(requested, returned) {
            const requestedKeys = new Set(requested.map(paramPhysicalRowKey));
            for (const row of returned) {
                const key = paramPhysicalRowKey(row.identity);
                if (!requestedKeys.has(key))
                    unrequestedPayloadRows += 1;
                payloadRows.add(key);
            }
        },
        snapshot() {
            return {
                rowCount: normalizedRowCount,
                indexRowsObserved: indexRows.size,
                selectedPayloadRowsObserved: payloadRows.size,
                unrequestedPayloadRows
            };
        }
    };
}
/**
 * selected-row 身份验证失败（rowIndex 越界 / id 不符 / dataHash 不符）。
 * 整批失败，禁止 partial success；错误负载只含 renderer-safe 字段。
 */
export const PARAM_ROW_IDENTITY_MISMATCH = 'PARAM_ROW_IDENTITY_MISMATCH';
//# sourceMappingURL=param-ipc-protocol.js.map