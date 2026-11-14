interface SourceBuildOptions {
    executable: string;
    args: string[];
    cwd: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onProgress?: (value: unknown) => void;
}
/** Source compilation owns a separate process and never feeds daemon NDJSON. */
export declare function prepareBridgeSourceBuild(options: SourceBuildOptions): Promise<void>;
export {};
