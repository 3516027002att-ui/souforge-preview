import type { BridgeDaemonResultPayload, BridgeRequestPayload } from '@soulforge/shared';
export interface BridgeDaemonClientOptions {
    executable: string;
    args?: string[];
    cwd?: string;
    workspaceSessionId: string;
    allowedRoots: string[];
    writableRoots?: string[];
    oodleRuntimeRoot?: string;
    maxFrameBytes?: number;
    maxConcurrency?: number;
    startupTimeoutMs?: number;
}
export interface BridgeDaemonRequestOptions<T = unknown> {
    payload: BridgeRequestPayload;
    resourceUri: string;
    timeoutMs: number;
    onProgress?: (payload: T) => void | Promise<void>;
    signal?: AbortSignal;
    /**
     * Optional request-local receipt for a daemon terminal frame that arrives
     * after this request was locally aborted or timed out.  The callback only
     * receives a redacted transport receipt; the main request promise keeps its
     * existing immediate rejection semantics.
     */
    onCancellationTerminal?: (receipt: BridgeCancellationTerminalReceipt) => void | Promise<void>;
}
export interface BridgeCancellationTerminalReceipt {
    requestId: string;
    outcome: 'result' | 'failed' | 'cancelled';
    receivedAt: string;
    /** True when caller/client cancellation was requested (abort or timeout); not proof a cancel frame reached the daemon. */
    cancelRequested: boolean;
}
export declare class BridgeDaemonError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(code: string, message: string, retryable?: boolean);
}
export declare class BridgeDaemonClient {
    readonly options: BridgeDaemonClientOptions;
    private readonly child;
    private readonly pending;
    private readonly cancellationTerminalObservers;
    /** 完整 NDJSON 行之前的有界分块；每个块约 16 KiB 或直接复用一个大 stdout chunk。 */
    private stdoutBlocks;
    /** 尚未达到分块阈值的 stdout 数据片段。 */
    private stdoutTailFragments;
    private stdoutTailBytes;
    /** 所有未完行片段的 UTF-8 字节数，含 blocks 与 tail。 */
    private stdoutBufferBytes;
    /** fatal transport/protocol 错误后停止消费旧 stdout；dispose admission 关闭不设置此标记。 */
    private stdoutFailed;
    private stderrTail;
    private closed;
    private negotiatedMaxFrameBytes;
    /**
     * 进行中的请求数。构造时子进程被 unref（见构造函数注释），所以有请求在飞时
     * 必须临时 ref 回来，否则宿主可能在响应到达前就退出而把请求静默丢掉。
     * 用计数而不是布尔：并发请求下先完成的那个不能把仍在等的请求的引用撤掉。
     */
    private inFlight;
    private constructor();
    static start(options: BridgeDaemonClientOptions): Promise<BridgeDaemonClient>;
    get isClosed(): boolean;
    /** True only when no request or late cancellation receipt still owns this client. */
    get isIdle(): boolean;
    request<TResult = unknown, TProgress = unknown>(options: BridgeDaemonRequestOptions<TProgress>): Promise<BridgeDaemonResultPayload<TResult>>;
    health(timeoutMs?: number): Promise<Record<string, unknown>>;
    capabilities(timeoutMs?: number): Promise<Record<string, unknown>>;
    dispose(): Promise<void>;
    private sendAndWait;
    /** 请求期间把子进程 ref 回来；见 inFlight 字段说明。 */
    private retain;
    private release;
    /**
     * child.unref() 只脱开进程句柄，三条 stdio 管道仍是活跃句柄。实测：只调
     * child.unref() 时进程仍挂死，`process._getActiveHandles()` 显示 6 个 Socket
     * （两个 daemon 客户端 × stdin/stdout/stderr）。
     *
     * Node 的类型声明把 stdio 标为 Readable/Writable，其上没有 ref/unref；但在
     * 管道模式下它们的实际实现是 net.Socket，确实带这两个方法。这里按运行期能力
     * 探测调用，而不是断言类型——某个平台上若真的不是 Socket，就安静跳过而不是崩。
     */
    private setStdioRef;
    private sendAndWaitInner;
    private sendCancel;
    private writeFrame;
    private consumeStdout;
    private appendStdoutFragment;
    private flushStdoutTailFragments;
    private takeStdoutLine;
    private clearStdoutFragments;
    private handleFrame;
    private registerCancellationTerminalObserver;
    private observeCancellationTerminal;
    private invokeCancellationTerminalObserver;
    private clearCancellationTerminalObservers;
    private resolvePending;
    private failProgressHandler;
    private failAll;
}
