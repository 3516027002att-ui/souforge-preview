interface HksReadData {
    sourceText?: string;
    sourceHash?: string;
    format?: string;
    dialect?: string;
}
interface HksReadReceipt {
    parseStatus: string;
    data?: HksReadData | null;
    diagnostics?: Array<{
        code?: string;
        message?: string;
        severity?: string;
    }>;
}
interface StandaloneScriptReadOptions {
    absolutePath: string;
    allowedRoots: string[];
    oodleRuntimeRoot?: string;
}
interface StandaloneScriptProbeDependencies {
    getFileSize?: (path: string) => Promise<number>;
    readBytes?: (path: string) => Promise<Uint8Array>;
    runHksSource?: (options: {
        command: 'read-hks-source';
        filePath: string;
        allowedRoots: string[];
        oodleRuntimeRoot?: string;
        commandOptions: Record<string, never>;
        timeoutMs: number;
        maxFrameBytes: number;
    }) => Promise<HksReadReceipt>;
}
/**
 * Mirror the standalone branch of `readScriptSource`: classify real bytes,
 * decode confirmed plaintext through the existing helper, and send bytecode
 * to the first-party native HKS reader. This is a reader-path probe, not a
 * second parser or a BND4 child projection.
 */
export declare function probeStandaloneScriptFile(options: StandaloneScriptReadOptions, dependencies?: StandaloneScriptProbeDependencies): Promise<{
    status: 'opened' | 'failed' | 'unavailable';
    detail: string;
}>;
export {};
