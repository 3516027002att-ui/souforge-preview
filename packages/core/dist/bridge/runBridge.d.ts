import type { BridgeCommandName, BridgeResult } from '@soulforge/shared';
import { type BridgeCancellationTerminalReceipt } from './bridgeDaemonClient.js';
export type BridgeCommand = Exclude<BridgeCommandName, 'capabilities' | 'health'>;
export type BridgeRequestPhase = 'command' | 'artifact';
export type RunBridgeCancellationTerminalReceipt = BridgeCancellationTerminalReceipt & {
    requestPhase: BridgeRequestPhase;
};
export interface RunBridgeOptions {
    bridgeProjectPath?: string;
    bridgeExecutablePath?: string;
    dotnetPath?: string;
    command: BridgeCommand;
    filePath: string;
    resourceUri?: string;
    allowedRoots?: string[];
    writableRoots?: string[];
    commandOptions?: Record<string, unknown>;
    oodleRuntimeRoot?: string;
    workspaceSessionId?: string;
    timeoutMs?: number;
    cwd?: string;
    signal?: AbortSignal;
    onProgress?: (payload: unknown) => void;
    onCancellationTerminal?: (receipt: RunBridgeCancellationTerminalReceipt) => void | Promise<void>;
    /**
     * 守护进程单帧上限（字节）。缺省 16 MiB；PARAM 全量载荷（includeAllPayloads）
     * 可到数 MB~29 MB base64，调用方按需提高（守护进程绝对上限 32 MiB）。
     */
    maxFrameBytes?: number;
    /**
     * 守护进程并发请求数。默认 2；仅对已证明可并行的读取批次提高，避免
     * 把所有 native writer/read 链路一起放大。
     */
    maxConcurrency?: number;
}
export type BridgeRunner = <T = unknown>(options: RunBridgeOptions) => Promise<BridgeResult<T>>;
export interface BridgeDaemonScope {
    run: BridgeRunner;
    dispose: () => Promise<void>;
}
interface DisposableBridgeClient {
    dispose: () => Promise<void>;
}
/**
 * Production Bridge entry. Requests are multiplexed over a pooled NDJSON
 * daemon; the legacy one-process-per-command CLI is retained only for explicit
 * fixture scripts and manual diagnostics.
 */
export declare function runBridge<T = unknown>(options: RunBridgeOptions): Promise<BridgeResult<T>>;
/**
 * Release idle process-wide native readers before a memory-heavy post-commit
 * semantic refresh. Active requests are leased and never interrupted; a later
 * request can recreate an evicted idle client with the same scoped identity.
 */
export declare function disposeIdleBridgeDaemonPool(): Promise<{
    disposedClientCount: number;
    activeClientCount: number;
}>;
/**
 * Create a short-lived Bridge client scope for operations that intentionally
 * add a unique, per-operation root (for example a PARAM unpack directory).
 *
 * The production pool remains process-wide and is not touched by this scope.
 * A scope owns every daemon it starts and drains in-flight requests before
 * disposing them, so callers can safely use it around a complete read flow,
 * including header/row-width retries and file-backed result materialization.
 */
export declare function createBridgeDaemonScope(): BridgeDaemonScope;
/**
 * Drain every client promise before reporting cleanup failure.  A rejected
 * dispose must not make callers tear down their temporary workspace while a
 * sibling daemon is still closing; all results are observed and failures are
 * rethrown after every client has settled.
 */
export declare function disposeBridgeClientPromises(active: Iterable<Promise<DisposableBridgeClient | undefined>>): Promise<void>;
export declare function disposeBridgeDaemonPool(): Promise<void>;
export {};
