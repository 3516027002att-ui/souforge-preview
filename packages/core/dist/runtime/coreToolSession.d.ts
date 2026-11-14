import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { type OperationLogStore } from '../patch/operationLog.js';
import type { NativeEditSession } from '../editing/nativeEditSession.js';
import { type NativeReadProofStore } from '../editing/nativeReadProofStore.js';
import { NativeSnapshotCache } from './nativeSnapshotCache.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
export interface SavedReferencePage {
    relations: Array<Record<string, unknown>>;
    offset: number;
    generation: number;
    scope?: string;
    state?: {
        target?: string;
        targetRead?: unknown;
        coverage?: Record<string, unknown>;
        diagnostics?: string[];
        nextActions?: Array<{
            tool: string;
            args: Record<string, unknown>;
        }>;
    };
}
export interface CoreToolSessionOptions {
    principal: string;
    workspaceId: string;
    workspaceSession?: WorkspaceSession;
    workspaceIndex?: WorkspaceIndex;
    editSession?: NativeEditSession;
    operationLog?: OperationLogStore;
    modeCeiling?: 'plan' | 'normal' | 'fullPermission';
}
export declare class CoreToolSession {
    readonly principal: string;
    readonly workspaceId: string;
    readonly workspaceSession: WorkspaceSession | undefined;
    readonly editSession: NativeEditSession | undefined;
    readonly snapshotCache: NativeSnapshotCache;
    readonly proofStore: NativeReadProofStore;
    readonly operationLog: OperationLogStore;
    readonly modeCeiling: 'plan' | 'normal' | 'fullPermission';
    private closed;
    private generation;
    private pages;
    private pageCounter;
    private sourceWatcher;
    private currentWorkspaceIndex;
    constructor(options: CoreToolSessionOptions);
    get workspaceIndex(): WorkspaceIndex;
    /** Replace a superseded semantic snapshot without changing session authority. */
    updateWorkspaceIndex(index: WorkspaceIndex, workspaceSession?: WorkspaceSession): boolean;
    /** 同一主体的长期 edit session：不再为每个工具调用新建 handle Map。 */
    requireEditSession(): NativeEditSession;
    /** 外层文件变化：一次失效其所有 child、快照、证明、关联分片与页会话（§400）。 */
    invalidateSource(outerSourceKey: string): void;
    /**
     * 已知绝对路径的外层文件变化：多键失效（原始串＋file:// 形＋工作区相对的规范资源 URI），
     * 与提交路径一致。监听器回调与未来调用方统一走这里，不各自拼 key。
     *
     * EMEVD 的读证明以外层源键 = 规范资源 URI（`file://event/...`）登记，而不是物理路径；
     * 只失效物理路径的两种拼写时，外部改动不会把这些证明标成可疑，只剩 writer 的 CAS 兜底。
     * 这里补上同一条工作区相对拼写，让「翻页后文件被外部改动」在门禁层就以 NATIVE_READ_STALE 失败关闭。
     */
    invalidateOuterFile(absolutePath: string): void;
    /**
     * 注册已知 canonical 外层文件的外部变化监听（宿主在打开文件时注册）。
     * 变化即走 invalidateOuterFile 全扇出；会话关闭时一并释放监听器。
     */
    watchOuterFile(absolutePath: string, pollIntervalMs?: number): void;
    /**
     * 本进程刚刚提交了对该文件的写入：把外部变化监听的基线对齐到提交后的状态。
     *
     * 证明的失效已经由提交路径精确发布（PARAM 按子表、TAE 按段）。若不重置基线，轮询器会在
     * 一秒内把这次「自己的写」当成外部改动，把同容器其它子表/段的读证明一并作废。
     */
    rebaselineOuterFile(absolutePath: string): void;
    /**
     * 写工具执行前的自我保护：这个路径上的变化是本进程造成的，轮询器不要当成外部改动上报。
     * 写者会在提交后精确发布失效（PARAM 按子表、TAE 按段）。
     */
    beginOuterWrite(absolutePath: string): void;
    endOuterWrite(absolutePath: string): void;
    /** 关联页续查：保存已确认排序前缀与页基准态，游标只在本会话本世代有效。 */
    saveReferencePage(relations: Array<Record<string, unknown>>, offset: number, scope?: string, state?: SavedReferencePage['state']): string;
    loadReferencePage(cursor: string): SavedReferencePage | null;
    get currentGeneration(): number;
    get isClosed(): boolean;
    close(): void;
}
