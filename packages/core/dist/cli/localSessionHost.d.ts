import { CoreToolSession } from '../runtime/coreToolSession.js';
import { type SessionTransactionOutcome } from '../runtime/operationOutcome.js';
export interface SessionRequest {
    id: string;
    tool: string;
    args: Record<string, unknown>;
}
export interface SessionError {
    code: string;
    message: string;
    retryable: boolean;
}
export interface SessionResult {
    id: string;
    ok: boolean;
    result?: unknown;
    error?: SessionError;
    requestState?: SessionRequestState;
    transaction?: SessionTransactionOutcome;
}
export type SessionRequestState = 'queued' | 'running' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed' | 'unknown';
export interface SessionRequestStatus {
    id: string;
    state: SessionRequestState;
    queuedAt: number;
    startedAt?: number;
    finishedAt?: number;
    cancelRequestedAt?: number;
    lateResultDiscarded?: boolean;
    opIds?: string[];
    outcome?: SessionResult;
}
export declare function sessionError(code: string, message: string, retryable?: boolean): SessionError;
export declare const MAX_FRAME_BYTES: number;
export declare const MAX_QUEUE = 64;
export declare class LocalSessionHost {
    readonly sessionName: string;
    readonly workspaceId: string;
    readonly authToken: string;
    readonly coreSession: CoreToolSession;
    private tracked;
    private inFlight;
    private requests;
    private tail;
    private pendingCount;
    private closed;
    private writerCalls;
    constructor(sessionName: string, workspaceId: string, principal: string, coreSession?: CoreToolSession);
    dispatch(request: SessionRequest, call: (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal): Promise<SessionResult>;
    /** Request cancellation is separate from the terminal cancelled state. */
    requestCancel(requestId: string): {
        ok: true;
        status: SessionRequestStatus;
    } | {
        ok: false;
        code: string;
        message: string;
    };
    requestStatus(requestId: string): SessionRequestStatus | undefined;
    operationStatus(opId: string): Promise<import("../runtime/operationOutcome.js").OperationOutcome>;
    resolveRequestStatus(requestId: string): Promise<SessionRequestStatus | undefined>;
    private recoverRequestOutcome;
    listRequestStatuses(): SessionRequestStatus[];
    get writerCallCount(): number;
    /** host 重启语义：proof 清空，审计保留（由 operationLog 持有）。 */
    restart(): void;
    close(): void;
}
export declare function openLocalSession(sessionName: string, workspaceId: string, principal: string, coreSession?: CoreToolSession): LocalSessionHost;
export declare function closeLocalSession(sessionName: string, workspaceId: string, principal: string): void;
