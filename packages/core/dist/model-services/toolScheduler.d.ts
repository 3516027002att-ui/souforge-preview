export interface ToolEffect {
    reads: readonly string[];
    writes: readonly string[];
    costClass?: 'interactive' | 'foreground' | 'background';
    deadlineAt?: number;
    cancelMode?: 'cooperative' | 'process' | 'none';
}
export interface ScheduledToolJob<T = unknown> {
    id: string;
    dependsOn?: readonly string[];
    effect: ToolEffect;
    run: (signal: AbortSignal | undefined) => Promise<T> | T;
}
export type ScheduledToolResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    code: string;
    message?: string;
};
export interface ToolScheduleOutcome<T> {
    results: Array<ScheduledToolResult<T> | undefined>;
    notificationErrors: string[];
    maxActive: number;
}
export declare function effectsConflict(a: ToolEffect, b: ToolEffect): boolean;
/** Run one model turn's jobs while retaining emission order and real active slots. */
export declare function runScheduledTools<T>(jobs: readonly ScheduledToolJob<T>[], options?: {
    concurrency?: number;
    signal?: AbortSignal;
    onEnd?: (event: {
        id: string;
        index: number;
        result: ScheduledToolResult<T>;
    }) => void;
}): Promise<ToolScheduleOutcome<T>>;
export declare function effectForTool(name: string, input: unknown): ToolEffect;
