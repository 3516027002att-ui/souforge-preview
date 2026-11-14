/**
 * DarkScript3 Document Semantic Snapshot & Windowed Service
 *
 * Provides sub-millisecond incremental access, viewport windowing, and
 * monotonic sequence tokens with cooperative cancellation for 50k+ line documents.
 */
import { type DocumentSymbolIndex, type EventSymbol } from "./eventSymbolIndexer.js";
import { type EventDiagnostic } from "./eventDiagnosticsEngine.js";
import type { EmedfCompletionItem } from "../emedfCompletionCatalog.js";
import type { EmedfEnumDef } from "../emedfSchema.js";
export interface CancellationToken {
    readonly isCancelled: boolean;
}
export declare class SimpleCancellationTokenSource {
    private _isCancelled;
    get token(): CancellationToken;
    cancel(): void;
}
export interface EventRange {
    eventId: number;
    restBehavior: string;
    from: number;
    to: number;
    lineStart: number;
    lineEnd: number;
    symbol: EventSymbol;
}
export declare class DocumentSemanticSnapshot {
    readonly version: number;
    readonly text: string;
    readonly lineCount: number;
    private readonly lineStarts;
    private _symbolIndex;
    private _eventRanges;
    constructor(text: string, version?: number);
    getLineOffset(line1Indexed: number): number;
    getLineNumber(offset: number): number;
    get symbolIndex(): DocumentSymbolIndex;
    get eventRanges(): readonly EventRange[];
    getEventAt(offset: number): EventRange | null;
    getEventsInWindow(startLine: number, endLine: number): EventRange[];
    computeWindowDiagnostics(window: {
        startLine: number;
        endLine: number;
    }, catalog: readonly EmedfCompletionItem[], enums?: Record<string, EmedfEnumDef>, cancellationToken?: CancellationToken): EventDiagnostic[];
}
