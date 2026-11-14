export interface Sf16ProtocolOptions {
    executable: string;
    root: string;
    sourcePath: string;
    queuePath?: string;
    maxFrameBytes?: number;
}
export interface Sf16ProtocolAudit {
    advertisedCount: number;
    descriptorCount: number;
    dispatchProbes: string[];
    invalidUtf8Code: string;
    incompleteEofCode: string;
    oversizedFrameCode: string;
    queueBusyObserved: number;
    cancellationObserved: boolean;
    maxActiveObserved: number;
}
/**
 * This helper deliberately launches the production daemon and speaks its raw
 * protocol. It is not a second Bridge implementation: it only provides a
 * small strict reader so the smoke can exercise malformed byte streams that
 * BridgeDaemonClient correctly refuses before JSON parsing.
 */
export declare function runSf16ProtocolAudit(options: Sf16ProtocolOptions): Promise<Sf16ProtocolAudit>;
