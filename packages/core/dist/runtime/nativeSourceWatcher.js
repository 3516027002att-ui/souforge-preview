/** T03 外层源外部变化监听：显式绝对路径轮询，无目录递归、无 symlink 跟随。 */
import { statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
function validateWatchPath(absolutePath) {
    if (typeof absolutePath !== 'string' || absolutePath.length === 0 || !isAbsolute(absolutePath)) {
        throw new Error('NATIVE_WATCH_PATH_INVALID');
    }
}
export class NativeSourceWatcher {
    watched = new Map();
    /**
     * 本进程正在写的路径。
     *
     * 一次提交会改 mtime/size，轮询器无法区分「自己的写」和「别人改了同一个文件」。若它在
     * 提交写盘与提交后精确失效之间抽到那一轮，就会把同容器里没被写到的子表/TAE 段的读证明
     * 一并作废（「读模板 → 写 A 段 → 写 B 段」因此第二次被拒）。写期间先挂起该路径的外部
     * 变化事件，写结束后把基线对齐到最终状态，之后的变化照常上报。
     */
    selfWriting = new Set();
    timer = null;
    closed = false;
    onEvent;
    onError;
    constructor(options) {
        if (options.pollIntervalMs !== undefined
            && (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs <= 0)) {
            throw new Error('NATIVE_WATCH_INTERVAL_INVALID');
        }
        if (typeof options.onEvent !== 'function')
            throw new Error('NATIVE_WATCH_EVENT_HANDLER_REQUIRED');
        this.onEvent = options.onEvent;
        this.onError = options.onError;
        this.timer = setInterval(() => {
            void this.pollOnce();
        }, options.pollIntervalMs ?? 1000);
        if (typeof this.timer.unref === 'function')
            this.timer.unref();
    }
    /**
     * 注册监听：同步建立基线（注册与首轮之间的写入不丢失），不 firing；
     * 重复注册保持原基线。基线不可读时留空，由首轮 poll 建立并上报错误。
     */
    watch(absolutePath) {
        if (this.closed)
            throw new Error('NATIVE_WATCHER_CLOSED');
        validateWatchPath(absolutePath);
        if (this.watched.has(absolutePath))
            return;
        let baseline = null;
        try {
            const attributes = statSync(absolutePath);
            baseline = { present: true, mtimeMs: attributes.mtimeMs, size: attributes.size };
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                baseline = { present: false, mtimeMs: 0, size: 0 };
            }
        }
        this.watched.set(absolutePath, baseline);
    }
    unwatch(absolutePath) {
        this.watched.delete(absolutePath);
    }
    /**
     * 本进程即将写这个文件：挂起它的外部变化事件，直到 endSelfWrite。
     * 写失败也要 endSelfWrite（基线对齐到实际状态）。
     */
    beginSelfWrite(absolutePath) {
        if (this.closed)
            return;
        this.selfWriting.add(absolutePath);
    }
    endSelfWrite(absolutePath) {
        if (!this.selfWriting.delete(absolutePath))
            return;
        this.rebaseline(absolutePath);
    }
    /**
     * 把某个已监听路径的基线重置为「当前状态」，不触发事件。
     *
     * 提交自己写的那一次变更后必须调用：写者已经精确地让受影响的证明过期，轮询器再把它当成
     * 「外部改动」整片作废一次，就会把同容器里没被写到的子表/TAE 段的证明一起打死。
     */
    rebaseline(absolutePath) {
        if (this.closed || !this.watched.has(absolutePath))
            return;
        try {
            const attributes = statSync(absolutePath);
            this.watched.set(absolutePath, { present: true, mtimeMs: attributes.mtimeMs, size: attributes.size });
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                this.watched.set(absolutePath, { present: false, mtimeMs: 0, size: 0 });
                return;
            }
            this.reportError(error, absolutePath);
        }
    }
    get watchedCount() {
        return this.watched.size;
    }
    get isClosed() {
        return this.closed;
    }
    /**
     * 单轮比对：首次观测只建基线；每次变化最多 firing 一次（轮询间多次写入合并）。
     * 宿主亦可主动驱动（测试/低频场景），与定时轮询互斥无关。
     */
    async pollOnce() {
        if (this.closed)
            return;
        for (const [absolutePath, baseline] of [...this.watched.entries()]) {
            if (this.closed || !this.watched.has(absolutePath))
                continue;
            let current;
            try {
                const attributes = await stat(absolutePath);
                current = { present: true, mtimeMs: attributes.mtimeMs, size: attributes.size };
            }
            catch (error) {
                if (error?.code !== 'ENOENT') {
                    this.reportError(error, absolutePath);
                    continue;
                }
                current = { present: false, mtimeMs: baseline?.mtimeMs ?? 0, size: baseline?.size ?? 0 };
            }
            if (baseline === null) {
                this.watched.set(absolutePath, current);
                continue;
            }
            if (this.selfWriting.has(absolutePath)) {
                // 本进程自己的写：把基线推到当前状态，不上报外部变化。
                this.watched.set(absolutePath, current);
                continue;
            }
            if (!baseline.present && current.present) {
                this.fire({ absolutePath, kind: 'created', mtimeMs: current.mtimeMs, size: current.size });
            }
            else if (baseline.present && !current.present) {
                this.fire({ absolutePath, kind: 'deleted', mtimeMs: baseline.mtimeMs, size: baseline.size });
            }
            else if (current.present && (current.mtimeMs !== baseline.mtimeMs || current.size !== baseline.size)) {
                this.fire({ absolutePath, kind: 'modified', mtimeMs: current.mtimeMs, size: current.size });
            }
            else {
                continue;
            }
            this.watched.set(absolutePath, current.present ? current : { present: false, mtimeMs: baseline.mtimeMs, size: baseline.size });
        }
    }
    fire(event) {
        try {
            this.onEvent(event);
        }
        catch (error) {
            this.reportError(error, event.absolutePath);
        }
    }
    reportError(error, absolutePath) {
        try {
            this.onError?.(error, absolutePath);
        }
        catch {
            // 兜底：轮询永不因错误出口自身异常而死。
        }
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        if (this.timer !== null)
            clearInterval(this.timer);
        this.timer = null;
        this.watched.clear();
    }
}
//# sourceMappingURL=nativeSourceWatcher.js.map