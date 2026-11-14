export declare const BRIDGE_RECOVERY_PHASES: readonly ["stage", "validate", "commit", "re-read"];
export type BridgeRecoveryPhase = typeof BRIDGE_RECOVERY_PHASES[number];
export type BridgeRecoveryHarnessFault = BridgeRecoveryPhase | 'timeout' | 'cancel' | 'progress-terminal-race' | 'process-exit';
export declare const BRIDGE_RECOVERY_PHASE_CODES: {
    readonly stage: "BRIDGE_HARNESS_STAGE_FAILED";
    readonly validate: "BRIDGE_HARNESS_VALIDATE_FAILED";
    readonly commit: "BRIDGE_HARNESS_COMMIT_FAILED";
    readonly 're-read': "BRIDGE_HARNESS_REREAD_FAILED";
};
export declare const BRIDGE_RECOVERY_FAULT_OPTION = "recoveryHarnessFault";
export interface BridgeRecoveryHarnessEvent {
    kind: 'handshake' | 'request' | 'cancel' | 'terminal';
    requestId: string;
    fault?: BridgeRecoveryHarnessFault;
    targetRequestId?: string;
}
export declare function isBridgeRecoveryHarnessFault(value: unknown): value is BridgeRecoveryHarnessFault;
