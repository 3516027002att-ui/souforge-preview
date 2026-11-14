export type SessionFeedbackRating = 'positive' | 'negative' | 'incomplete';
export interface BuildFingerprint {
    appVersion: string;
    commitSha?: string;
    promptVersion?: string;
    toolRegistryVersion?: string;
    model?: string;
    provider?: string;
    semanticIndexRevision?: string;
    ragCorpusRevision?: string;
}
export interface SessionFeedbackInput {
    sessionId: string;
    rating: SessionFeedbackRating;
    comment?: string;
}
export interface FeedbackTracePayload {
    sessionId: string;
    fileName: string;
    encoding: 'jsonl';
    content: string;
}
export type FeedbackUploadEnvelope = {
    schemaVersion: 1;
    kind: 'session-feedback';
    submissionId: string;
    submittedAt: string;
    notify: true;
    build: BuildFingerprint;
    feedback: {
        rating: SessionFeedbackRating;
        comment?: string;
    };
    trace: FeedbackTracePayload;
} | {
    schemaVersion: 1;
    kind: 'history-session';
    submissionId: string;
    submittedAt: string;
    notify: false;
    build: BuildFingerprint;
    partIndex: number;
    trace: FeedbackTracePayload;
} | {
    schemaVersion: 1;
    kind: 'history-complete';
    submissionId: string;
    submittedAt: string;
    notify: true;
    build: BuildFingerprint;
    uploadedSessions: number;
    failedSessions: Array<{
        sessionId: string;
        code: string;
    }>;
};
export type FeedbackEndpointResult = {
    ok: true;
    status: number;
} | {
    ok: false;
    code: 'ENDPOINT_INVALID' | 'PAYLOAD_TOO_LARGE' | 'NETWORK_FAILED' | 'HTTP_REJECTED';
    status?: number;
    message: string;
};
export interface FeedbackEndpoint {
    submit(payload: FeedbackUploadEnvelope): Promise<FeedbackEndpointResult>;
}
export interface HttpFeedbackEndpointOptions {
    maxPayloadBytes?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}
/**
 * Public-client endpoint: no Google/Gmail credential is stored here. The
 * endpoint URL is the only cloud coordinate the desktop app needs to know.
 */
export declare class HttpFeedbackEndpoint implements FeedbackEndpoint {
    private readonly maxPayloadBytes;
    private readonly timeoutMs;
    private readonly fetchImpl;
    private readonly endpointUrl;
    constructor(endpoint: string, options?: HttpFeedbackEndpointOptions);
    submit(payload: FeedbackUploadEnvelope): Promise<FeedbackEndpointResult>;
}
export interface SessionFeedbackServiceOptions {
    maxSessions?: number;
    maxTraceBytes?: number;
}
export type SubmitSessionFeedbackResult = {
    ok: true;
    submissionId: string;
} | {
    ok: false;
    code: 'INVALID_INPUT' | 'SESSION_NOT_FOUND' | 'TRACE_READ_FAILED' | 'TRACE_TOO_LARGE' | 'UPLOAD_FAILED';
    message: string;
};
export interface SubmitAllHistoryResult {
    ok: boolean;
    submissionId: string;
    uploadedSessions: number;
    failedSessions: Array<{
        sessionId: string;
        code: string;
    }>;
}
/**
 * Bridges the existing append-only rollout JSONL authority to the remote
 * feedback sink. Renderer-facing callers identify a session by sessionId;
 * they never provide a filesystem path, preventing the feedback channel from
 * becoming an arbitrary local-file exfiltration primitive.
 */
export declare class SessionFeedbackService {
    private readonly rolloutBaseDir;
    private readonly endpoint;
    private readonly build;
    private readonly maxSessions;
    private readonly maxTraceBytes;
    constructor(rolloutBaseDir: string, endpoint: FeedbackEndpoint, build: BuildFingerprint, options?: SessionFeedbackServiceOptions);
    submitSessionFeedback(input: SessionFeedbackInput): Promise<SubmitSessionFeedbackResult>;
    /**
     * Full-history upload intentionally sends one sanitized rollout per request.
     * That keeps each public Web App request bounded and lets a partial network
     * failure be reported precisely instead of losing one giant bundle.
     */
    submitAllHistory(): Promise<SubmitAllHistoryResult>;
    private readTrace;
}
/**
 * Preserve the rollout record shape and game/tool evidence. Only credential
 * fields and obvious credential strings are redacted. Malformed lines are
 * retained after text-level redaction rather than silently discarded.
 */
export declare function sanitizeRolloutJsonl(raw: string): string;
