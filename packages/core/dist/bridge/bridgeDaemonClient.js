import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BRIDGE_PROTOCOL_VERSION } from '@soulforge/shared';
const MAX_CANCELLATION_TERMINAL_OBSERVERS = 64;
// Native cancellation may only become observable after a long synchronous
// section; keep the receipt window finite without making a ref'ed timer.
const CANCELLATION_TERMINAL_OBSERVER_MAX_TTL_MS = 30_000;
const STDOUT_FRAGMENT_BLOCK_BYTES = 16 * 1024;
export class BridgeDaemonError extends Error {
    code;
    retryable;
    constructor(code, message, retryable = false) {
        super(message);
        this.code = code;
        this.retryable = retryable;
    }
}
export class BridgeDaemonClient {
    options;
    child;
    pending = new Map();
    cancellationTerminalObservers = new Map();
    /** 完整 NDJSON 行之前的有界分块；每个块约 16 KiB 或直接复用一个大 stdout chunk。 */
    stdoutBlocks = [];
    /** 尚未达到分块阈值的 stdout 数据片段。 */
    stdoutTailFragments = [];
    stdoutTailBytes = 0;
    /** 所有未完行片段的 UTF-8 字节数，含 blocks 与 tail。 */
    stdoutBufferBytes = 0;
    /** fatal transport/protocol 错误后停止消费旧 stdout；dispose admission 关闭不设置此标记。 */
    stdoutFailed = false;
    stderrTail = '';
    closed = false;
    negotiatedMaxFrameBytes;
    /**
     * 进行中的请求数。构造时子进程被 unref（见构造函数注释），所以有请求在飞时
     * 必须临时 ref 回来，否则宿主可能在响应到达前就退出而把请求静默丢掉。
     * 用计数而不是布尔：并发请求下先完成的那个不能把仍在等的请求的引用撤掉。
     */
    inFlight = 0;
    constructor(options) {
        this.options = options;
        this.negotiatedMaxFrameBytes = options.maxFrameBytes ?? 1024 * 1024;
        this.child = spawn(options.executable, [...(options.args ?? []), 'daemon'], {
            cwd: options.cwd,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        // daemon 子进程与其 stdio 都是活跃句柄，会让宿主 node 进程无法退出。
        // 实测后果：runNativeFlverSmoke 的成功路径漏调 disposeBridgeDaemonPool()，
        // 于是进程挂死 4 小时（CPU 全程 0.1s 无增长）、锁住 bin 下的 SoulForge.Bridge.exe，
        // 使后续 bridge:build 与整个 native 层失败。仓库里 37 个用 runBridge 的
        // smoke/probe 全都没把 dispose 放进 finally，靠调用方记得关是不可靠的。
        //
        // unref 让「忘记 dispose」退化为「进程正常退出」而不是「挂死」。这不会产生
        // 孤儿进程：BridgeDaemonHost 在 ReadLineAsync 返回 null（stdin 关闭）时会
        // break 退出主循环，宿主退出即断管道即触发它自行终止。
        // 显式 dispose() 仍是首选路径（它会等 close 并在 2s 后 kill），unref 只是兜底。
        this.child.unref();
        this.setStdioRef('unref');
        this.child.stdout.setEncoding('utf8');
        this.child.stderr.setEncoding('utf8');
        this.child.stdout.on('data', (chunk) => this.consumeStdout(chunk));
        this.child.stderr.on('data', (chunk) => {
            this.stderrTail = `${this.stderrTail}${chunk}`.slice(-16 * 1024);
        });
        this.child.stdin.on('error', (error) => this.failAll(new BridgeDaemonError('BRIDGE_STDIN_FAILED', error.message, true)));
        this.child.once('error', (error) => this.failAll(new BridgeDaemonError('BRIDGE_SPAWN_FAILED', error.message, true)));
        this.child.once('close', (code, signal) => this.failAll(new BridgeDaemonError('BRIDGE_PROCESS_EXITED', `Bridge process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}). ${this.stderrTail}`.trim(), true)));
    }
    static async start(options) {
        const client = new BridgeDaemonClient(options);
        try {
            const payload = {
                allowedRoots: options.allowedRoots,
                ...(options.writableRoots?.length ? { writableRoots: options.writableRoots } : {}),
                ...(options.oodleRuntimeRoot ? { oodleRuntimeRoot: options.oodleRuntimeRoot } : {}),
                maxFrameBytes: options.maxFrameBytes ?? 1024 * 1024,
                maxConcurrency: options.maxConcurrency ?? 2
            };
            const frame = await client.sendAndWait('handshake', payload, new Set(['handshake', 'failed']), options.startupTimeoutMs ?? 15_000);
            if (frame.kind === 'failed')
                throw failureFromFrame(frame);
            const response = asRecord(frame.payload);
            if (typeof response.maxFrameBytes === 'number') {
                client.negotiatedMaxFrameBytes = response.maxFrameBytes;
            }
            return client;
        }
        catch (error) {
            await client.dispose();
            throw error;
        }
    }
    get isClosed() {
        return this.closed;
    }
    /** True only when no request or late cancellation receipt still owns this client. */
    get isIdle() {
        return this.inFlight === 0 && this.pending.size === 0 && this.cancellationTerminalObservers.size === 0;
    }
    async request(options) {
        const frame = await this.sendAndWait('request', options.payload, new Set(['result', 'failed', 'cancelled']), options.timeoutMs, options.resourceUri, options.onProgress, options.signal, options.onCancellationTerminal);
        if (frame.kind === 'failed')
            throw failureFromFrame(frame);
        if (frame.kind === 'cancelled') {
            throw new BridgeDaemonError('BRIDGE_REQUEST_CANCELLED', 'Bridge request was cancelled.', true);
        }
        return frame.payload;
    }
    async health(timeoutMs = 5_000) {
        const frame = await this.sendAndWait('health', {}, new Set(['health', 'failed']), timeoutMs);
        if (frame.kind === 'failed')
            throw failureFromFrame(frame);
        return asRecord(frame.payload);
    }
    async capabilities(timeoutMs = 5_000) {
        const frame = await this.sendAndWait('capabilities', {}, new Set(['capabilities', 'failed']), timeoutMs);
        if (frame.kind === 'failed')
            throw failureFromFrame(frame);
        return asRecord(frame.payload);
    }
    async dispose() {
        if (this.closed)
            return;
        this.closed = true;
        // 关闭期间同样要 ref：子进程处于 unref 状态时，'close' 事件不足以维持事件
        // 循环，宿主可能在收到它之前就退出，使这个 await 永远拿不到结果。
        this.retain();
        this.child.stdin.end();
        const close = once(this.child, 'close');
        const timeout = setTimeout(() => this.child.kill(), 2_000);
        try {
            await close;
        }
        finally {
            clearTimeout(timeout);
            this.release();
            this.clearStdoutFragments();
        }
    }
    async sendAndWait(kind, payload, terminalKinds, timeoutMs, resourceUri, onProgress, signal, onCancellationTerminal) {
        if (this.closed)
            throw new BridgeDaemonError('BRIDGE_CLIENT_CLOSED', 'Bridge client is closed.');
        if (signal?.aborted) {
            throw new BridgeDaemonError('BRIDGE_REQUEST_CANCELLED', 'Bridge request was cancelled.', true);
        }
        this.retain();
        try {
            return await this.sendAndWaitInner(kind, payload, terminalKinds, timeoutMs, resourceUri, onProgress, signal, onCancellationTerminal);
        }
        finally {
            this.release();
        }
    }
    /** 请求期间把子进程 ref 回来；见 inFlight 字段说明。 */
    retain() {
        this.inFlight += 1;
        if (this.inFlight === 1) {
            this.child.ref();
            this.setStdioRef('ref');
        }
    }
    release() {
        this.inFlight -= 1;
        if (this.inFlight === 0) {
            this.child.unref();
            this.setStdioRef('unref');
        }
    }
    /**
     * child.unref() 只脱开进程句柄，三条 stdio 管道仍是活跃句柄。实测：只调
     * child.unref() 时进程仍挂死，`process._getActiveHandles()` 显示 6 个 Socket
     * （两个 daemon 客户端 × stdin/stdout/stderr）。
     *
     * Node 的类型声明把 stdio 标为 Readable/Writable，其上没有 ref/unref；但在
     * 管道模式下它们的实际实现是 net.Socket，确实带这两个方法。这里按运行期能力
     * 探测调用，而不是断言类型——某个平台上若真的不是 Socket，就安静跳过而不是崩。
     */
    setStdioRef(mode) {
        for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
            const fn = stream[mode];
            if (typeof fn === 'function')
                fn.call(stream);
        }
    }
    async sendAndWaitInner(kind, payload, terminalKinds, timeoutMs, resourceUri, onProgress, signal, onCancellationTerminal) {
        const requestId = randomUUID();
        const deadlineUtc = new Date(Date.now() + timeoutMs).toISOString();
        const writeController = new AbortController();
        let registeredPending;
        const result = new Promise((resolve, reject) => {
            const pending = {
                terminalKinds,
                resolve,
                reject,
                progressChain: Promise.resolve(),
                requestFrameDispatched: false,
                ...(onProgress ? { onProgress } : {}),
                ...(onCancellationTerminal ? { onCancellationTerminal } : {})
            };
            registeredPending = pending;
            pending.timer = setTimeout(() => {
                if (this.pending.get(requestId) !== pending)
                    return;
                this.pending.delete(requestId);
                pending.abortCleanup?.();
                writeController.abort('timeout');
                if (pending.terminalFrame !== undefined) {
                    this.invokeCancellationTerminalObserver(pending.terminalFrame, pending, true);
                }
                else {
                    this.registerCancellationTerminalObserver(requestId, pending, true);
                    void this.sendCancel(requestId);
                }
                reject(new BridgeDaemonError('BRIDGE_TIMEOUT', `Bridge request timed out after ${timeoutMs}ms.`, true));
            }, timeoutMs);
            if (signal) {
                const onAbort = () => {
                    const requestFrameDispatched = pending.requestFrameDispatched;
                    this.pending.delete(requestId);
                    if (pending.timer)
                        clearTimeout(pending.timer);
                    writeController.abort('cancelled');
                    if (pending.terminalFrame !== undefined) {
                        this.invokeCancellationTerminalObserver(pending.terminalFrame, pending, true);
                    }
                    else if (requestFrameDispatched) {
                        this.registerCancellationTerminalObserver(requestId, pending, true);
                        void this.sendCancel(requestId);
                    }
                    else {
                        void this.sendCancel(requestId);
                    }
                    reject(new BridgeDaemonError('BRIDGE_REQUEST_CANCELLED', 'Bridge request was cancelled.', true));
                };
                if (signal.aborted)
                    onAbort();
                else {
                    signal.addEventListener('abort', onAbort, { once: true });
                    pending.abortCleanup = () => signal.removeEventListener('abort', onAbort);
                }
            }
            if (!signal?.aborted)
                this.pending.set(requestId, pending);
        });
        // A backpressured write can outlive the request timer; keep the inner rejection observed.
        void result.catch(() => undefined);
        if (registeredPending === undefined
            || this.pending.get(requestId) !== registeredPending)
            return result;
        try {
            await this.writeFrame({
                protocolVersion: BRIDGE_PROTOCOL_VERSION,
                kind,
                requestId,
                workspaceSessionId: this.options.workspaceSessionId,
                deadlineUtc,
                ...(resourceUri ? { resourceUri } : {}),
                payload
            }, writeController.signal);
            // A write that is still backpressured when cancellation fires is not
            // strong enough evidence that the daemon received the request.  Keep
            // that conservative case receipt-free rather than fabricating native
            // observation; only a completed frame write is dispatch evidence.
            registeredPending.requestFrameDispatched = true;
        }
        catch (error) {
            const pending = this.pending.get(requestId);
            if (pending !== undefined && pending === registeredPending) {
                this.pending.delete(requestId);
                if (pending.timer)
                    clearTimeout(pending.timer);
                pending.abortCleanup?.();
                pending.reject(error instanceof Error ? error : new BridgeDaemonError('BRIDGE_WRITE_FAILED', 'Bridge request frame could not be written.', true));
            }
        }
        return result;
    }
    async sendCancel(targetRequestId) {
        if (this.closed || !this.child.stdin.writable)
            return;
        const payload = { targetRequestId };
        await this.writeFrame({
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            kind: 'cancel',
            requestId: randomUUID(),
            workspaceSessionId: this.options.workspaceSessionId,
            payload
        }).catch(() => undefined);
    }
    async writeFrame(frame, signal) {
        const line = `${JSON.stringify(frame)}\n`;
        if (Buffer.byteLength(line, 'utf8') > this.negotiatedMaxFrameBytes) {
            throw new BridgeDaemonError('BRIDGE_FRAME_TOO_LARGE', 'Outbound Bridge frame exceeds the negotiated limit.');
        }
        await new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                this.child.stdin.off('error', onStdinError);
                this.child.stdin.off('close', onStdinClose);
                this.child.off('close', onProcessClose);
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const writeFailure = (message) => new BridgeDaemonError('BRIDGE_WRITE_FAILED', message, true);
            const onAbort = () => finish(writeFailure('Bridge frame write was cancelled.'));
            const onStdinError = (error) => finish(writeFailure(error.message));
            const onStdinClose = () => finish(writeFailure('Bridge stdin closed before the frame was written.'));
            const onProcessClose = () => finish(writeFailure('Bridge process exited before the frame was written.'));
            if (signal?.aborted) {
                onAbort();
                return;
            }
            if (this.closed || !this.child.stdin.writable) {
                onStdinClose();
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            this.child.stdin.once('error', onStdinError);
            this.child.stdin.once('close', onStdinClose);
            this.child.once('close', onProcessClose);
            try {
                this.child.stdin.write(line, 'utf8', (error) => {
                    if (error)
                        onStdinError(error);
                    else
                        finish();
                });
            }
            catch (error) {
                onStdinError(error instanceof Error ? error : writeFailure('Bridge frame write failed.'));
            }
        });
    }
    consumeStdout(chunk) {
        if (this.stdoutFailed)
            return;
        // A complete line can span many Readable chunks. Search only this new
        // chunk; older incomplete text stays in bounded fragments and is joined
        // once, when its newline arrives. The 2x check intentionally includes the
        // whole incoming chunk, matching the previous buffered-byte boundary.
        const incomingBytes = Buffer.byteLength(chunk, 'utf8');
        if (this.stdoutBufferBytes + incomingBytes > this.negotiatedMaxFrameBytes * 2) {
            this.failAll(new BridgeDaemonError('BRIDGE_FRAME_TOO_LARGE', 'Bridge stdout exceeded the frame buffer limit.'));
            this.child.kill();
            return;
        }
        let lineStart = 0;
        while (true) {
            const newline = chunk.indexOf('\n', lineStart);
            if (newline < 0)
                break;
            const newFragment = chunk.slice(lineStart, newline);
            const rawLine = this.takeStdoutLine(newFragment);
            const line = rawLine.trim();
            lineStart = newline + 1;
            if (!line)
                continue;
            if (Buffer.byteLength(line, 'utf8') > this.negotiatedMaxFrameBytes) {
                this.failAll(new BridgeDaemonError('BRIDGE_FRAME_TOO_LARGE', 'Inbound Bridge frame exceeds the negotiated limit.'));
                this.child.kill();
                return;
            }
            try {
                const frame = JSON.parse(line);
                this.handleFrame(frame);
            }
            catch (error) {
                this.failAll(new BridgeDaemonError('BRIDGE_INVALID_JSON', error instanceof Error ? error.message : String(error)));
                this.child.kill();
                return;
            }
            // A protocol mismatch calls failAll() from handleFrame. Stop before a
            // later line in this same Readable chunk can be mistaken for valid data.
            if (this.stdoutFailed)
                return;
        }
        this.appendStdoutFragment(chunk.slice(lineStart));
    }
    appendStdoutFragment(fragment) {
        if (!fragment)
            return;
        const bytes = Buffer.byteLength(fragment, 'utf8');
        this.stdoutBufferBytes += bytes;
        if (bytes >= STDOUT_FRAGMENT_BLOCK_BYTES) {
            this.flushStdoutTailFragments();
            this.stdoutBlocks.push(fragment);
            return;
        }
        this.stdoutTailFragments.push(fragment);
        this.stdoutTailBytes += bytes;
        if (this.stdoutTailBytes >= STDOUT_FRAGMENT_BLOCK_BYTES) {
            this.flushStdoutTailFragments();
        }
    }
    flushStdoutTailFragments() {
        if (this.stdoutTailFragments.length === 0)
            return;
        this.stdoutBlocks.push(this.stdoutTailFragments.join(''));
        this.stdoutTailFragments = [];
        this.stdoutTailBytes = 0;
    }
    takeStdoutLine(lastFragment) {
        if (this.stdoutBlocks.length === 0 && this.stdoutTailFragments.length === 0)
            return lastFragment;
        if (lastFragment)
            this.stdoutTailFragments.push(lastFragment);
        const line = [...this.stdoutBlocks, ...this.stdoutTailFragments].join('');
        this.clearStdoutFragments();
        return line;
    }
    clearStdoutFragments() {
        this.stdoutBlocks = [];
        this.stdoutTailFragments = [];
        this.stdoutTailBytes = 0;
        this.stdoutBufferBytes = 0;
    }
    handleFrame(frame) {
        if (frame.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
            this.failAll(new BridgeDaemonError('BRIDGE_PROTOCOL_MISMATCH', `Expected ${BRIDGE_PROTOCOL_VERSION}, received ${frame.protocolVersion}.`));
            this.child.kill();
            return;
        }
        if (frame.workspaceSessionId
            && frame.workspaceSessionId !== this.options.workspaceSessionId)
            return;
        if (!frame.requestId)
            return;
        const pending = this.pending.get(frame.requestId);
        if (!pending) {
            this.observeCancellationTerminal(frame);
            return;
        }
        if (frame.kind === 'progress') {
            if (pending.terminalFrame !== undefined || pending.onProgress === undefined)
                return;
            const onProgress = pending.onProgress;
            pending.progressChain = pending.progressChain.then(() => onProgress(frame.payload));
            void pending.progressChain.catch(() => {
                this.failProgressHandler(frame.requestId, pending);
            });
            return;
        }
        if (!pending.terminalKinds.has(frame.kind))
            return;
        if (pending.terminalFrame !== undefined)
            return;
        pending.terminalFrame = frame;
        void pending.progressChain.then(() => this.resolvePending(frame.requestId, pending, frame), () => this.failProgressHandler(frame.requestId, pending));
    }
    registerCancellationTerminalObserver(requestId, pending, cancelRequested) {
        if (!pending.onCancellationTerminal || !pending.requestFrameDispatched)
            return;
        if (this.cancellationTerminalObservers.size >= MAX_CANCELLATION_TERMINAL_OBSERVERS)
            return;
        const observer = {
            onTerminal: pending.onCancellationTerminal,
            cancelRequested
        };
        observer.timer = setTimeout(() => {
            if (this.cancellationTerminalObservers.get(requestId) !== observer)
                return;
            this.cancellationTerminalObservers.delete(requestId);
        }, CANCELLATION_TERMINAL_OBSERVER_MAX_TTL_MS);
        const timerWithUnref = observer.timer;
        timerWithUnref.unref?.();
        this.cancellationTerminalObservers.set(requestId, observer);
    }
    observeCancellationTerminal(frame) {
        // Normal pending requests preserve the historical leniency for fixture
        // frames without a workspace session id.  A late receipt is stronger
        // evidence, so it must carry the exact session identity.
        if (frame.workspaceSessionId !== this.options.workspaceSessionId)
            return;
        if (frame.kind !== 'result' && frame.kind !== 'failed' && frame.kind !== 'cancelled')
            return;
        if (!frame.requestId)
            return;
        const observer = this.cancellationTerminalObservers.get(frame.requestId);
        if (!observer)
            return;
        this.cancellationTerminalObservers.delete(frame.requestId);
        if (observer.timer)
            clearTimeout(observer.timer);
        this.invokeCancellationTerminalObserver(frame, observer);
    }
    invokeCancellationTerminalObserver(frame, pending, cancelRequested) {
        if (frame.workspaceSessionId !== this.options.workspaceSessionId)
            return;
        if (frame.kind !== 'result' && frame.kind !== 'failed' && frame.kind !== 'cancelled')
            return;
        if (!frame.requestId)
            return;
        const onTerminal = 'onTerminal' in pending
            ? pending.onTerminal
            : pending.onCancellationTerminal;
        if (!onTerminal)
            return;
        const receipt = {
            requestId: frame.requestId,
            outcome: frame.kind,
            receivedAt: new Date().toISOString(),
            cancelRequested: cancelRequested ?? ('cancelRequested' in pending ? pending.cancelRequested : false)
        };
        try {
            void Promise.resolve(onTerminal(receipt)).catch(() => undefined);
        }
        catch {
            // A receipt observer is diagnostic-only and must never affect transport.
        }
    }
    clearCancellationTerminalObservers() {
        for (const observer of this.cancellationTerminalObservers.values()) {
            if (observer.timer)
                clearTimeout(observer.timer);
        }
        this.cancellationTerminalObservers.clear();
    }
    resolvePending(requestId, pending, frame) {
        if (this.pending.get(requestId) !== pending)
            return;
        this.pending.delete(requestId);
        if (pending.timer)
            clearTimeout(pending.timer);
        pending.abortCleanup?.();
        pending.resolve(frame);
    }
    failProgressHandler(requestId, pending) {
        if (this.pending.get(requestId) !== pending)
            return;
        this.pending.delete(requestId);
        if (pending.timer)
            clearTimeout(pending.timer);
        pending.abortCleanup?.();
        if (pending.terminalFrame === undefined)
            void this.sendCancel(requestId);
        pending.reject(new BridgeDaemonError('BRIDGE_PROGRESS_HANDLER_FAILED', 'The Bridge progress handler failed while processing a progress frame.'));
    }
    failAll(error) {
        this.stdoutFailed = true;
        this.clearStdoutFragments();
        if (this.closed && this.pending.size === 0 && this.cancellationTerminalObservers.size === 0)
            return;
        this.closed = true;
        for (const pending of this.pending.values()) {
            if (pending.timer)
                clearTimeout(pending.timer);
            pending.abortCleanup?.();
            pending.reject(error);
        }
        this.pending.clear();
        this.clearCancellationTerminalObservers();
    }
}
function failureFromFrame(frame) {
    const payload = asRecord(frame.payload);
    return new BridgeDaemonError(typeof payload.code === 'string' ? payload.code : 'BRIDGE_REQUEST_FAILED', typeof payload.message === 'string' ? payload.message : 'Bridge request failed.', payload.retryable === true);
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
//# sourceMappingURL=bridgeDaemonClient.js.map