/**
 * SF-12 ResourceLockSet
 *
 * 资源锁集合与宿主级锁协调机制：
 * 1. 锁键由 workspaceId 与规范化 canonicalOuterId 组成。
 * 2. 依赖资源申请 shared (读) 锁，写目标申请 exclusive (写) 锁。
 * 3. 同一锁键的 R/W 请求在入锁前静态合并为 W (exclusive)，禁止运行中锁升级。
 * 4. 全部锁在进入临界区前按键名严格字典序排序后依次获取，杜绝循环等待死锁。
 * 5. 支持获取超时与主动释放。
 */
export type ResourceLockMode = 'shared' | 'exclusive';
export interface ResourceLockRequest {
    key: string;
    mode: ResourceLockMode;
    resourceUri?: string;
}
export interface ResourceLockLease {
    leaseId: string;
    workspaceId: string;
    acquiredKeys: string[];
    heldModes: ReadonlyMap<string, ResourceLockMode>;
    released: boolean;
    release(): Promise<void>;
}
export interface ResourceLockOptions {
    timeoutMs?: number;
}
/**
 * 由 workspaceId 与 outer 目标绝对路径规范化生成锁键。
 */
export declare function canonicalLockKey(workspaceId: string, canonicalOuterPathOrId: string): string;
/**
 * 静态合并 R/W 锁请求：同键 R+W -> W，并按键字典序排序。
 */
export declare function normalizeLockRequests(requests: readonly ResourceLockRequest[]): ResourceLockRequest[];
/**
 * 在已静态合并、排序的锁集合内执行一次临界区。调用方不会拿到可以升级的
 * 中间句柄；任一锁失败会在回调前释放已经取得的前缀锁。
 */
export declare function withResourceLocks<T>(manager: ResourceLockManager, workspaceId: string, requests: readonly ResourceLockRequest[], work: (lease: ResourceLockLease) => Promise<T>, options?: ResourceLockOptions): Promise<T>;
export declare class ResourceLockManager {
    private static instance;
    private readonly locks;
    static getInstance(): ResourceLockManager;
    static resetInstance(): void;
    private getOrCreateLockState;
    /**
     * 按照全局字典序获取一组资源的锁。如果任一锁在指定超时内获取失败，
     * 则释放所有已持有的锁并抛出异常。
     */
    acquireLocks(workspaceId: string, requests: readonly ResourceLockRequest[], options?: ResourceLockOptions): Promise<ResourceLockLease>;
    private acquireSingleLock;
    private releaseSingleLock;
    private processQueue;
}
