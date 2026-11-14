/**
 * Long-Term Memory Store (Codex MEMORY.md parser, serializer and search engine).
 */
import type { MemoryEntry, MemorySaveInput, MemoryStoreData } from './memoryTypes.js';
export interface MemoryStore {
    list(): MemoryEntry[];
    get(idOrTopic: string): MemoryEntry | undefined;
    search(query: string, limit?: number): MemoryEntry[];
    save(entry: MemorySaveInput): MemoryEntry;
    delete(idOrTopic: string): boolean;
    serializeMarkdown(): string;
    formatForSystemPrompt(maxEntries?: number): string;
}
/**
 * Parse a structured MEMORY.md markdown string into MemoryStoreData.
 *
 * Supported format:
 * # Project Long-Term Memory
 *
 * ## [topic-name] Summary title
 * <!-- tags: tag1, tag2 -->
 * Detailed notes...
 */
export declare function parseMemoryMarkdown(markdown: string): MemoryStoreData;
/**
 * Serialize MemoryStoreData into human-readable, editable MEMORY.md markdown.
 */
export declare function serializeMemoryMarkdown(data: MemoryStoreData): string;
export declare class InMemoryMemoryStore implements MemoryStore {
    private readonly entriesMap;
    constructor(initialData?: MemoryStoreData | string);
    list(): MemoryEntry[];
    get(idOrTopic: string): MemoryEntry | undefined;
    search(query: string, limit?: number): MemoryEntry[];
    save(entry: MemorySaveInput): MemoryEntry;
    delete(idOrTopic: string): boolean;
    serializeMarkdown(): string;
    formatForSystemPrompt(maxEntries?: number): string;
}
