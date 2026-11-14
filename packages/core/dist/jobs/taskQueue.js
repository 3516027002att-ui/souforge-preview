/**
 * Small cancellable queue for parsing, indexing, bridge calls, and validations.
 * It keeps heavyweight work outside the renderer and provides progress/state hooks.
 */
export class TaskQueue {
    concurrency;
    pending = [];
    tasks = new Map();
    runningCount = 0;
    constructor(options = {}) {
        this.concurrency = Math.max(1, options.concurrency ?? 2);
    }
    enqueue(title, handler) {
        const id = makeTaskId();
        const controller = new AbortController();
        let resolve;
        let reject;
        const promise = new Promise((promiseResolve, promiseReject) => {
            resolve = promiseResolve;
            reject = promiseReject;
        });
        const task = {
            id,
            title,
            status: 'queued',
            progress: { current: 0 },
            createdAt: Date.now(),
            promise,
            handler,
            controller,
            resolve,
            reject,
            cancel: () => this.cancel(id)
        };
        this.tasks.set(id, task);
        this.pending.push(task);
        this.pump();
        return task;
    }
    list() {
        return [...this.tasks.values()].map(stripInternalFields);
    }
    get(id) {
        const task = this.tasks.get(id);
        return task ? stripInternalFields(task) : undefined;
    }
    cancel(id) {
        const task = this.tasks.get(id);
        if (!task || task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled')
            return false;
        task.controller.abort();
        if (task.status === 'queued') {
            task.status = 'cancelled';
            task.completedAt = Date.now();
            task.reject(new Error(`Task cancelled: ${task.title}`));
            const index = this.pending.findIndex((item) => item.id === id);
            if (index !== -1)
                this.pending.splice(index, 1);
        }
        return true;
    }
    cancelAll() {
        for (const task of this.tasks.values())
            this.cancel(task.id);
    }
    pump() {
        while (this.runningCount < this.concurrency) {
            const task = this.pending.shift();
            if (!task)
                return;
            if (task.status === 'cancelled')
                continue;
            void this.runTask(task);
        }
    }
    async runTask(task) {
        this.runningCount += 1;
        task.status = 'running';
        task.startedAt = Date.now();
        try {
            const result = await task.handler({
                signal: task.controller.signal,
                reportProgress: (progress) => {
                    task.progress = progress;
                }
            });
            if (task.controller.signal.aborted) {
                task.status = 'cancelled';
                task.completedAt = Date.now();
                task.reject(new Error(`Task cancelled: ${task.title}`));
                return;
            }
            task.status = 'completed';
            task.completedAt = Date.now();
            task.resolve(result);
        }
        catch (error) {
            task.status = task.controller.signal.aborted ? 'cancelled' : 'failed';
            task.completedAt = Date.now();
            task.error = error instanceof Error ? error.message : String(error);
            task.reject(error);
        }
        finally {
            this.runningCount -= 1;
            this.pump();
        }
    }
}
function stripInternalFields(task) {
    return {
        id: task.id,
        title: task.title,
        status: task.status,
        progress: task.progress,
        createdAt: task.createdAt,
        ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
        ...(task.completedAt === undefined ? {} : { completedAt: task.completedAt }),
        ...(task.error === undefined ? {} : { error: task.error }),
        promise: task.promise,
        cancel: task.cancel
    };
}
function makeTaskId() {
    return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
//# sourceMappingURL=taskQueue.js.map