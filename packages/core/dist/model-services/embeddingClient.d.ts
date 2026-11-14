/**
 * OpenAI-compatible embedding client (POST /v1/embeddings).
 *
 * Only openai-compatible services support embeddings — Anthropic has no
 * embedding endpoint, so the anthropic-compatible protocol is out of scope.
 * Credentials never appear in diagnostics or returned payloads.
 */
export interface FetchEmbeddingsOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Texts to embed; empty array returns ok with an empty vector list. */
    inputs: readonly string[];
    signal?: AbortSignal;
    /** Per-request timeout in milliseconds. */
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    /**
     * Max texts per POST. OpenAI caps at 2048; 64 keeps one batch small enough
     * for local models while bounding request count for large corpora.
     */
    batchSize?: number;
}
export type EmbeddingBatchResult = {
    ok: true;
    vectors: Float32Array[];
    dim: number;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/**
 * Embed a list of texts, batching by `batchSize`. Vectors are ordered to match
 * `inputs` even when the server returns `data` out of order (matched by `index`).
 */
export declare function fetchEmbeddings(options: FetchEmbeddingsOptions): Promise<EmbeddingBatchResult>;
/** 余弦相似度（a、b 必须等长；任意一方为零向量返回 0）。 */
export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
