/** T03 两端共用工具运行时：持有工作区运行时，构造一次，关闭一次。 */
import { isAbsolute, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { MemoryOperationLogStore } from '../patch/operationLog.js';
import { createNativeReadProofStore } from '../editing/nativeReadProofStore.js';
import { NativeSnapshotCache } from './nativeSnapshotCache.js';
import { NativeSourceWatcher } from './nativeSourceWatcher.js';
export class CoreToolSession {
    principal;
    workspaceId;
    workspaceSession;
    editSession;
    snapshotCache;
    proofStore;
    operationLog;
    modeCeiling;
    closed = false;
    generation = 0;
    pages = new Map();
    pageCounter = 0;
    sourceWatcher = null;
    currentWorkspaceIndex;
    constructor(options) {
        this.principal = options.principal;
        this.workspaceId = options.workspaceId;
        this.workspaceSession = options.workspaceSession;
        this.currentWorkspaceIndex = options.workspaceIndex ?? new WorkspaceIndex(options.workspaceId);
        this.editSession = options.editSession;
        this.snapshotCache = new NativeSnapshotCache();
        this.proofStore = createNativeReadProofStore();
        this.operationLog = options.operationLog ?? new MemoryOperationLogStore();
        this.modeCeiling = options.modeCeiling ?? 'normal';
    }
    get workspaceIndex() {
        return this.currentWorkspaceIndex;
    }
    /** Replace a superseded semantic snapshot without changing session authority. */
    updateWorkspaceIndex(index, workspaceSession) {
        if (this.closed || index.workspaceId !== this.workspaceId)
            return false;
        if (this.workspaceSession !== workspaceSession)
            return false;
        this.currentWorkspaceIndex = index;
        return true;
    }
    /** 同一主体的长期 edit session：不再为每个工具调用新建 handle Map。 */
    requireEditSession() {
        if (!this.editSession)
            throw new Error('CORE_SESSION_NO_EDIT_SESSION');
        return this.editSession;
    }
    /** 外层文件变化：一次失效其所有 child、快照、证明、关联分片与页会话（§400）。 */
    invalidateSource(outerSourceKey) {
        this.generation += 1;
        this.snapshotCache.invalidateOuter(outerSourceKey);
        this.proofStore.invalidateSource(outerSourceKey, this.generation);
        // 页游标凭世代失配拒绝（不清表，保留更明确的 SCOPE_MISMATCH 而非 EXPIRED）。
        this.workspaceIndex.invalidateSource(outerSourceKey);
    }
    /**
     * 已知绝对路径的外层文件变化：多键失效（原始串＋file:// 形＋工作区相对的规范资源 URI），
     * 与提交路径一致。监听器回调与未来调用方统一走这里，不各自拼 key。
     *
     * EMEVD 的读证明以外层源键 = 规范资源 URI（`file://event/...`）登记，而不是物理路径；
     * 只失效物理路径的两种拼写时，外部改动不会把这些证明标成可疑，只剩 writer 的 CAS 兜底。
     * 这里补上同一条工作区相对拼写，让「翻页后文件被外部改动」在门禁层就以 NATIVE_READ_STALE 失败关闭。
     */
    invalidateOuterFile(absolutePath) {
        this.invalidateSource(absolutePath);
        if (!absolutePath.includes('://')) {
            try {
                this.invalidateSource(pathToFileURL(absolutePath).href);
            }
            catch {
                // 保留原始串失效；路径转换失败不掩盖失效本身。
            }
            const overlayRoot = this.workspaceSession?.layers.overlayRoot;
            if (overlayRoot !== undefined && overlayRoot !== '') {
                const relativePath = relative(overlayRoot, absolutePath);
                if (relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)) {
                    this.invalidateSource(`file://${relativePath.replaceAll('\\', '/')}`);
                }
            }
        }
    }
    /**
     * 注册已知 canonical 外层文件的外部变化监听（宿主在打开文件时注册）。
     * 变化即走 invalidateOuterFile 全扇出；会话关闭时一并释放监听器。
     */
    watchOuterFile(absolutePath, pollIntervalMs) {
        if (this.closed)
            throw new Error('CORE_SESSION_CLOSED');
        if (process.env.SOULFORGE_DEBUG_PROOF === '1')
            process.stderr.write(`[proof:watch] ${absolutePath}\n`);
        if (!this.sourceWatcher) {
            this.sourceWatcher = new NativeSourceWatcher({
                ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
                onEvent: (event) => {
                    if (!this.closed)
                        this.invalidateOuterFile(event.absolutePath);
                }
            });
        }
        this.sourceWatcher.watch(absolutePath);
    }
    /**
     * 本进程刚刚提交了对该文件的写入：把外部变化监听的基线对齐到提交后的状态。
     *
     * 证明的失效已经由提交路径精确发布（PARAM 按子表、TAE 按段）。若不重置基线，轮询器会在
     * 一秒内把这次「自己的写」当成外部改动，把同容器其它子表/段的读证明一并作废。
     */
    rebaselineOuterFile(absolutePath) {
        if (this.closed || this.sourceWatcher === null)
            return;
        this.sourceWatcher.rebaseline(absolutePath);
    }
    /**
     * 写工具执行前的自我保护：这个路径上的变化是本进程造成的，轮询器不要当成外部改动上报。
     * 写者会在提交后精确发布失效（PARAM 按子表、TAE 按段）。
     */
    beginOuterWrite(absolutePath) {
        if (this.closed)
            return;
        this.sourceWatcher?.beginSelfWrite(absolutePath);
    }
    endOuterWrite(absolutePath) {
        if (this.sourceWatcher === null)
            return;
        this.sourceWatcher.endSelfWrite(absolutePath);
    }
    /** 关联页续查：保存已确认排序前缀与页基准态，游标只在本会话本世代有效。 */
    saveReferencePage(relations, offset, scope, state) {
        if (this.closed)
            throw new Error('CORE_SESSION_CLOSED');
        this.pageCounter += 1;
        const cursor = `pg-${this.pageCounter}`;
        this.pages.set(cursor, {
            relations, offset, generation: this.generation,
            ...(scope === undefined ? {} : { scope }),
            ...(state === undefined ? {} : { state })
        });
        return cursor;
    }
    loadReferencePage(cursor) {
        if (this.closed)
            return null;
        return this.pages.get(cursor) ?? null;
    }
    get currentGeneration() {
        return this.generation;
    }
    get isClosed() {
        return this.closed;
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.sourceWatcher?.close();
        this.sourceWatcher = null;
        // CoreToolSession may remain reachable through an Agent bridge until its
        // promise settles. Do not keep the last full workspace snapshot alive.
        this.currentWorkspaceIndex = new WorkspaceIndex(this.workspaceId);
        this.snapshotCache.dispose();
        this.proofStore.invalidateAll('session-close');
        this.proofStore.dispose();
        this.pages.clear();
    }
}
//# sourceMappingURL=coreToolSession.js.map