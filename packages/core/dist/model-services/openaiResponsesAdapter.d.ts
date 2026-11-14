/**
 * OpenAI Responses API adapter (`POST /v1/responses`).
 * Distinct from Chat Completions compatible adapter; both normalize to StreamEvent.
 * Credentials never appear in diagnostics or returned DTOs.
 */
import type { ModelCompleteRequest, ModelCompleteResult, ModelListResult, ModelServiceAdapter, StreamEvent } from './types.js';
export interface OpenAiResponsesAdapterOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    sessionId?: string | undefined;
    fetchImpl?: typeof fetch;
}
export declare class OpenAiResponsesAdapter implements ModelServiceAdapter {
    readonly protocol: "openai-responses";
    readonly transport: "openai-responses";
    private readonly baseUrl;
    private readonly apiKey;
    private readonly model;
    private readonly defaultSessionId?;
    private readonly fetchImpl;
    constructor(options: OpenAiResponsesAdapterOptions);
    private resolveSessionId;
    complete(request: ModelCompleteRequest): Promise<ModelCompleteResult>;
    listModels(options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        sessionId?: string;
    }): Promise<ModelListResult>;
    stream(request: ModelCompleteRequest): AsyncGenerator<StreamEvent, void, undefined>;
    private fetchResponses;
}
