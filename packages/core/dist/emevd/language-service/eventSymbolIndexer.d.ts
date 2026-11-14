/**
 * Deterministic Event Symbol & Outline Indexer for EMEVD DarkScript3.
 *
 * Fast linear indexing across 70,000+ line documents for:
 * - Outline symbols (eventId, restBehavior, instruction count, parameter slots, lines)
 * - Go to Event / Symbol fuzzy search (Ctrl+Shift+O)
 * - Event definition & references lookup (F12 / Shift+F12)
 */
export interface EventSymbol {
    eventId: number;
    restBehavior: string;
    line: number;
    from: number;
    to: number;
    parameterSlots: string[];
    instructionCount: number;
    warnings: number;
    errors: number;
}
export interface EventReference {
    targetEventId: number;
    callingEventId?: number;
    callerLine: number;
    from: number;
    to: number;
    instructionName: string;
}
export interface DocumentSymbolIndex {
    symbols: EventSymbol[];
    byEventId: Map<number, EventSymbol>;
    references: EventReference[];
}
/**
 * Perform a single-pass linear indexing of all events and references in document.
 */
export declare function indexDocumentSymbols(text: string): DocumentSymbolIndex;
/**
 * Filter and rank event symbols by query (for Ctrl+Shift+O Go to Symbol).
 */
export declare function searchEventSymbols(query: string, symbols: readonly EventSymbol[]): EventSymbol[];
/**
 * Find all references targeting a specific event ID.
 */
export declare function findEventReferences(eventId: number, index: DocumentSymbolIndex): EventReference[];
