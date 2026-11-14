/**
 * TEST-ONLY synthetic protocol helpers used by architecture smoke tests.
 * This module is intentionally not exported from @soulforge/core; production
 * Bridge traffic must use BridgeDaemonClient and the C# daemon.
 */
import type { BridgeCapabilityMatrix, BridgeCommandDescriptor, BridgeProtocolEnvelope, BridgeTypedFailure } from '@soulforge/shared';
export declare const SCAFFOLD_BRIDGE_COMMANDS: BridgeCommandDescriptor[];
export declare function buildScaffoldCapabilityMatrix(bridgeId?: string): BridgeCapabilityMatrix;
export declare function createSyntheticInspectEnvelope(filePath: string): BridgeProtocolEnvelope<{
    filePath: string;
    note: string;
}>;
export declare function createTypedFailureEnvelope(command: BridgeProtocolEnvelope['command'], failure: BridgeTypedFailure): BridgeProtocolEnvelope;
export declare function unsupportedNativeWriterFailure(): BridgeTypedFailure;
export declare function schemaMismatchFailure(expected: string, actual: string): BridgeTypedFailure;
