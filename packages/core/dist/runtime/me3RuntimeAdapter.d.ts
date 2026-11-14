import type { GameRuntimeAdapter, RuntimeCallContext, RuntimeCapability, RuntimeDiagnostics, RuntimeLaunchRequest, RuntimeLaunchSession, RuntimeOperationResult, RuntimeProfileRef, RuntimeTerminationResult, RuntimeWorkspaceRef } from './gameRuntimeAdapter.js';
export type Me3DiscoverySource = 'registry' | 'well-known' | 'path';
export type Me3SpawnFailure = 'not-executable' | 'permission-denied' | 'process-unavailable' | 'unknown';
export interface Me3VersionProbeProcessResult {
    exitCode: number | null;
    stdout: string;
    stdoutTruncated: boolean;
    stderrObserved: boolean;
    stderrTruncated: boolean;
    timedOut: boolean;
    cancelled: boolean;
    spawnFailure: Me3SpawnFailure | null;
}
export type Me3DetectionGatewayResult = {
    status: 'not-found';
    checkedSources: readonly Me3DiscoverySource[];
} | {
    status: 'ambiguous';
    candidateCount: number;
    discoverySources: readonly Me3DiscoverySource[];
} | {
    status: 'probed';
    discoverySource: Me3DiscoverySource;
    process: Me3VersionProbeProcessResult;
};
export interface Me3VersionProbeRequest {
    operation: 'version-probe';
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface Me3ProfileCreateRequest {
    operation: 'profile-create';
    profileName: string;
    game: 'sekiro';
    packagePaths: string[];
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface Me3ProfileCreateResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    cancelled: boolean;
    spawnFailure: Me3SpawnFailure | null;
}
export interface Me3LaunchRequest {
    operation: 'launch';
    profileName: string;
    game: 'sekiro';
    diagnostics: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}
export interface Me3LaunchResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    cancelled: boolean;
    spawnFailure: Me3SpawnFailure | null;
    pid?: number;
}
export interface Me3TerminateRequest {
    operation: 'terminate';
    pid: number;
    timeoutMs: number;
}
export interface Me3TerminateResult {
    terminated: boolean;
}
/**
 * Privileged port implemented outside core. It owns executable discovery and
 * the fixed `me3 --version` subprocess, and must not return authority-bearing
 * paths, process ids, argv, cwd, or environment values.
 */
export interface Me3RuntimeGateway {
    probeVersion(request: Me3VersionProbeRequest): Promise<unknown>;
    createProfile(request: Me3ProfileCreateRequest): Promise<unknown>;
    launchGame(request: Me3LaunchRequest): Promise<unknown>;
    terminateProcess(request: Me3TerminateRequest): Promise<unknown>;
}
export interface Me3VersionPolicy {
    policyId: string;
    supportedVersions: readonly string[];
}
export interface Me3RuntimeAdapterOptions {
    gateway: Me3RuntimeGateway;
    versionPolicy?: Me3VersionPolicy;
}
export declare class Me3RuntimeAdapter implements GameRuntimeAdapter {
    readonly adapterId = "me3";
    readonly game: "sekiro";
    private readonly gateway;
    private readonly versionPolicy;
    private readonly sessionPids;
    constructor(options: Me3RuntimeAdapterOptions);
    detect(context: RuntimeCallContext): Promise<RuntimeCapability>;
    prepareProfile(workspace: RuntimeWorkspaceRef, context: RuntimeCallContext): Promise<RuntimeOperationResult<RuntimeProfileRef>>;
    launch(request: RuntimeLaunchRequest, context: RuntimeCallContext): Promise<RuntimeOperationResult<RuntimeLaunchSession>>;
    collectDiagnostics(session: RuntimeLaunchSession, _context: RuntimeCallContext): Promise<RuntimeOperationResult<RuntimeDiagnostics>>;
    terminate(session: RuntimeLaunchSession, context: RuntimeCallContext): Promise<RuntimeOperationResult<RuntimeTerminationResult>>;
    private classifyProbe;
}
