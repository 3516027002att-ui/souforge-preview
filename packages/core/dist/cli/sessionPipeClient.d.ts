import { type SessionError, type SessionRequestState } from './localSessionHost.js';
import { type SessionTransactionOutcome } from '../runtime/operationOutcome.js';
export declare class SessionTransportError extends Error {
    readonly requestId: string;
    readonly code: string;
    readonly retryable = false;
    readonly transaction: SessionTransactionOutcome;
    constructor(requestId: string, code: string, cause?: Error);
}
export interface PipeSessionCall {
    id: string;
    tool: string;
    args: Record<string, unknown>;
}
export interface PipeSessionResult {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: SessionError;
    requestState?: SessionRequestState;
    transaction?: SessionTransactionOutcome;
}
export declare class SessionPipeClient {
    private socket;
    private buffer;
    private pending;
    private handshakeDone;
    connect(workspaceKey: string, sessionName: string): Promise<void>;
    call(request: PipeSessionCall): Promise<PipeSessionResult>;
    cancel(requestId: string): Promise<PipeSessionResult>;
    requestStatus(requestId: string): Promise<PipeSessionResult>;
    operationStatus(opId: string): Promise<PipeSessionResult>;
    close(): void;
    private roundTrip;
    private onData;
    private failPending;
}
