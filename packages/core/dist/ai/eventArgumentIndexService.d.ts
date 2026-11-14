/**
 * 工作区事件参数索引的加载入口（工具共用）。
 *
 * 索引本身在 `references/eventInstructionIndex.ts`；这里只负责：
 *   1. 从 WorkspaceIndex 取已索引、非备份的 EMEVD 文件；
 *   2. 用 first-party EMEVD registry 解码；
 *   3. 通过 Bridge 完整文档读取（分页由 fullDocument 负责）。
 * 构建结果按工作区 + 文件指纹缓存，因此 `search_events`、`explain_miniboss`
 * 共用同一份 47 文件索引。
 */
import type { Diagnostic } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import type { NativeEditSession } from '../editing/nativeEditSession.js';
import { type EventInstructionIndex, type EventInstructionIndexFile } from '../references/eventInstructionIndex.js';
export type EventInstructionIndexLoadResult = {
    ok: true;
    index: EventInstructionIndex;
} | {
    ok: false;
    code: string;
    message: string;
    diagnostics?: Diagnostic[];
};
/** 只保留真正的 EMEVD 语义源；`.bak`、缓存、投影文件不进入索引。 */
export declare function workspaceEventInstructionFiles(ws: WorkspaceIndex): EventInstructionIndexFile[];
export declare function loadWorkspaceEventInstructionIndex(input: {
    workspaceId: string;
    ws: WorkspaceIndex;
    edit: NativeEditSession;
    signal?: AbortSignal;
}): Promise<EventInstructionIndexLoadResult>;
