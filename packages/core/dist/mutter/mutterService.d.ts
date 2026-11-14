export interface MutterLoadResult {
    ok: boolean;
    count: number;
    revision: number;
    code?: 'MUTTER_FILE_UNAVAILABLE' | 'MUTTER_READ_FAILED';
}
/**
 * Extract one mutter per line. Only a line fully wrapped in straight double
 * quotes is data; blank lines, headings and every other Markdown line are
 * intentionally ignored.
 */
export declare function parseMutterMarkdown(markdown: string): string[];
/**
 * Tiny, failure-isolated runtime for the UI-only mutter pool.
 *
 * It never talks to the Agent, RAG, Patch Engine or model-service layer. The
 * caller asks for `next()` when the UI wants another line. A shuffle bag is
 * used instead of independent random picks so a short pool does not visibly
 * repeat itself.
 */
export declare class MutterService {
    readonly filePath: string;
    private readonly random;
    private entries;
    private queue;
    private revision;
    private watcher;
    private reloadTimer;
    private lastReturned;
    constructor(filePath: string, random?: () => number);
    load(): Promise<MutterLoadResult>;
    next(): string | null;
    snapshot(): {
        count: number;
        revision: number;
    };
    /**
     * Optional hot reload. fs.watch is deliberately best-effort: watcher errors
     * and malformed/missing files only empty/reload this cosmetic pool and can
     * never fail application startup.
     */
    startWatching(debounceMs?: number): void;
    stopWatching(): void;
    dispose(): void;
    private refillQueue;
}
