/**
 * OpenAI-compatible Chat Completions adapter (also covers OpenAI Responses-style
 * chat endpoints that accept /v1/chat/completions).
 */
import type { ModelCompleteRequest, ModelCompleteResult, ModelListResult, ModelServiceAdapter, StreamEvent } from './types.js';
export interface OpenAiCompatibleAdapterOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    sessionId?: string | undefined;
    fetchImpl?: typeof fetch;
}
export declare class OpenAiCompatibleAdapter implements ModelServiceAdapter {
    readonly protocol: "openai-compatible";
    private readonly baseUrl;
    private readonly apiKey;
    private readonly model;
    private readonly defaultSessionId?;
    private readonly fetchImpl;
    constructor(options: OpenAiCompatibleAdapterOptions);
    private resolveSessionId;
    complete(request: ModelCompleteRequest): Promise<ModelCompleteResult>;
    listModels(options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        sessionId?: string;
    }): Promise<ModelListResult>;
    stream(request: ModelCompleteRequest): AsyncGenerator<StreamEvent, void, undefined>;
}
