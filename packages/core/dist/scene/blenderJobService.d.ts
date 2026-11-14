import type { BlenderJobManifest, BlenderJobState } from '@soulforge/shared';
export interface BlenderProcessLike {
    stdout?: {
        on(event: 'data', listener: (chunk: Buffer | string) => void): void;
    };
    stderr?: {
        on(event: 'data', listener: (chunk: Buffer | string) => void): void;
    };
    once(event: 'close' | 'error', listener: (value: number | Error | null) => void): void;
    kill(signal?: NodeJS.Signals): boolean;
}
export type BlenderSpawn = (file: string, args: readonly string[], options: {
    cwd: string;
    shell: false;
    stdio: ['ignore', 'pipe', 'pipe'];
    env: NodeJS.ProcessEnv;
}) => BlenderProcessLike;
export interface BlenderJobRequest {
    manifest: BlenderJobManifest;
    trustedBlenderPath: string;
    trustedAdapterPath: string;
    trustedManifestPath: string;
    stagingRoot: string;
    resultManifestPath?: string;
    approvedEnvironment?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
}
export interface BlenderJobResult {
    jobId: string;
    state: BlenderJobState;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    diagnostics: Array<{
        code: string;
        message: string;
    }>;
}
export declare function buildBlenderInvocation(input: Pick<BlenderJobRequest, 'trustedBlenderPath' | 'trustedAdapterPath' | 'trustedManifestPath'>): {
    file: string;
    args: string[];
};
export declare class BlenderJobService {
    private readonly spawn;
    private readonly queue;
    private active;
    constructor(spawn?: BlenderSpawn);
    submit(request: BlenderJobRequest): Promise<BlenderJobResult>;
    private drain;
    private run;
}
