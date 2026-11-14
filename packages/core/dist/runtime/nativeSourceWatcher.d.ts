export type NativeSourceChangeKind = 'modified' | 'deleted' | 'created';
export interface NativeSourceChangeEvent {
    absolutePath: string;
    kind: NativeSourceChangeKind;
    /** 观测到的新状态；deleted 时为最后已知状态。 */
    mtimeMs: number;
    size: number;
}
export interface NativeSourceWatcherOptions {
    /** 轮询间隔毫秒；宿主按需调优，默认 1000。 */
    pollIntervalMs?: number;
    onEvent: (event: NativeSourceChangeEvent) => void;
    /** 回调异常隔离出口；缺席则吞掉并继续轮询（宿主应提供以便可观测）。 */
    onError?: (error: unknown, absolutePath?: string) => void;
}
export declare class NativeSourceWatcher {
    private readonly watched;
    /**
     * 本进程正在写的路径。
     *
     * 一次提交会改 mtime/size，轮询器无法区分「自己的写」和「别人改了同一个文件」。若它在
     * 提交写盘与提交后精确失效之间抽到那一轮，就会把同容器里没被写到的子表/TAE 段的读证明
     * 一并作废（「读模板 → 写 A 段 → 写 B 段」因此第二次被拒）。写期间先挂起该路径的外部
     * 变化事件，写结束后把基线对齐到最终状态，之后的变化照常上报。
     */
    private readonly selfWriting;
    private timer;
    private closed;
    private readonly onEvent;
    private readonly onError;
    constructor(options: NativeSourceWatcherOptions);
    /**
     * 注册监听：同步建立基线（注册与首轮之间的写入不丢失），不 firing；
     * 重复注册保持原基线。基线不可读时留空，由首轮 poll 建立并上报错误。
     */
    watch(absolutePath: string): void;
    unwatch(absolutePath: string): void;
    /**
     * 本进程即将写这个文件：挂起它的外部变化事件，直到 endSelfWrite。
     * 写失败也要 endSelfWrite（基线对齐到实际状态）。
     */
    beginSelfWrite(absolutePath: string): void;
    endSelfWrite(absolutePath: string): void;
    /**
     * 把某个已监听路径的基线重置为「当前状态」，不触发事件。
     *
     * 提交自己写的那一次变更后必须调用：写者已经精确地让受影响的证明过期，轮询器再把它当成
     * 「外部改动」整片作废一次，就会把同容器里没被写到的子表/TAE 段的证明一起打死。
     */
    rebaseline(absolutePath: string): void;
    get watchedCount(): number;
    get isClosed(): boolean;
    /**
     * 单轮比对：首次观测只建基线；每次变化最多 firing 一次（轮询间多次写入合并）。
     * 宿主亦可主动驱动（测试/低频场景），与定时轮询互斥无关。
     */
    pollOnce(): Promise<void>;
    private fire;
    private reportError;
    close(): void;
}
