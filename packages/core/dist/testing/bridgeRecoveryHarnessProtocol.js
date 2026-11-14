export const BRIDGE_RECOVERY_PHASES = [
    'stage',
    'validate',
    'commit',
    're-read'
];
export const BRIDGE_RECOVERY_PHASE_CODES = {
    stage: 'BRIDGE_HARNESS_STAGE_FAILED',
    validate: 'BRIDGE_HARNESS_VALIDATE_FAILED',
    commit: 'BRIDGE_HARNESS_COMMIT_FAILED',
    're-read': 'BRIDGE_HARNESS_REREAD_FAILED'
};
export const BRIDGE_RECOVERY_FAULT_OPTION = 'recoveryHarnessFault';
export function isBridgeRecoveryHarnessFault(value) {
    return value === 'timeout'
        || value === 'cancel'
        || value === 'progress-terminal-race'
        || value === 'process-exit'
        || BRIDGE_RECOVERY_PHASES.includes(String(value));
}
//# sourceMappingURL=bridgeRecoveryHarnessProtocol.js.map