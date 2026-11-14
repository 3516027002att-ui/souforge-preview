export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface TaskProgress {
    current: number;
    total?: number;
    message?: string;
}
export interface TaskContext {
    signal: AbortSignal;
    reportProgress: (progress: TaskProgress) => void;
}
export interface QueuedTask<T> {
    id: string;
    title: string;
    status: TaskStatus;
    progress: TaskProgress;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
    promise: Promise<T>;
    cancel: () => void;
}
type TaskHandler<T> = (context: TaskContext) => Promise<T>;
export interface TaskQueueOptions {
    concurrency?: number;
}
/**
 * Small cancellable queue for parsing, indexing, bridge calls, and validations.
 * It keeps heavyweight work outside the renderer and provides progress/state hooks.
 */
export declare class TaskQueue {
    private readonly concurrency;
    private readonly pending;
    private readonly tasks;
    private runningCount;
    constructor(options?: TaskQueueOptions);
    enqueue<T>(title: string, handler: TaskHandler<T>): QueuedTask<T>;
    list(): QueuedTask<unknown>[];
    get(id: string): QueuedTask<unknown> | undefined;
    cancel(id: string): boolean;
    cancelAll(): void;
    private pump;
    private runTask;
}
export {};
