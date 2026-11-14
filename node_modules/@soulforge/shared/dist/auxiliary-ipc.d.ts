export declare const AUXILIARY_IPC_CHANNELS: {
    readonly mutterNext: "mutter.next";
    readonly mutterStatus: "mutter.status";
    readonly feedbackStatus: "feedback.status";
    readonly feedbackSubmitSession: "feedback.submitSession";
    readonly feedbackSubmitAll: "feedback.submitAllHistory";
};
export type SessionFeedbackRating = 'positive' | 'negative' | 'incomplete';
export interface SessionFeedbackIpcRequest {
    sessionId: string;
    rating: SessionFeedbackRating;
    comment?: string;
}
export interface MutterNextIpcResult {
    text: string | null;
    count: number;
    revision: number;
}
export interface MutterStatusIpcResult {
    count: number;
    revision: number;
}
export interface FeedbackStatusIpcResult {
    configured: boolean;
    appVersion: string;
}
export type SessionFeedbackIpcResult = {
    ok: true;
    submissionId: string;
} | {
    ok: false;
    code: 'INVALID_INPUT' | 'ENDPOINT_NOT_CONFIGURED' | 'SESSION_NOT_FOUND' | 'TRACE_READ_FAILED' | 'TRACE_TOO_LARGE' | 'UPLOAD_FAILED';
    message: string;
};
export interface SubmitAllHistoryIpcResult {
    ok: boolean;
    submissionId: string;
    uploadedSessions: number;
    failedSessions: Array<{
        sessionId: string;
        code: string;
    }>;
}
