/**
 * Anthropic Messages API compatible adapter.
 */
import type { ModelCompleteRequest, ModelCompleteResult, ModelListResult, ModelServiceAdapter, StreamEvent } from './types.js';
export interface AnthropicCompatibleAdapterOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    sessionId?: string | undefined;
    fetchImpl?: typeof fetch;
    apiVersion?: string;
}
export declare class AnthropicCompatibleAdapter implements ModelServiceAdapter {
    readonly protocol: "anthropic-compatible";
    private readonly baseUrl;
    private readonly apiKey;
    private readonly model;
    private readonly defaultSessionId?;
    private readonly fetchImpl;
    private readonly apiVersion;
    constructor(options: AnthropicCompatibleAdapterOptions);
    private resolveSessionId;
    complete(request: ModelCompleteRequest): Promise<ModelCompleteResult>;
    listModels(options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        sessionId?: string;
    }): Promise<ModelListResult>;
    stream(request: ModelCompleteRequest): AsyncGenerator<StreamEvent, void, undefined>;
}
