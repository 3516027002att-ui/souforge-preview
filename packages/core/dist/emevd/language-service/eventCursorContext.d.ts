/**
 * Deterministic Bounded Cursor Context Analyzer for DarkScript3 / EMEVD source.
 *
 * Provides syntax-tolerant contextual inspection for live editing:
 * - Unclosed calls (e.g. `ShootBullet(` or `ShootBullet(10000, `)
 * - Multi-line nested calls and predicates (e.g. `WaitFor(\n  CharacterDead(X0_4)\n  && CharacterHasSpEffect(|`)
 * - Active argument index & argument range tracking
 * - Enclosing $Event and formal parameter slot discovery (X0_4, X4_4, etc.)
 * - Bounded lookback/lookahead to maintain sub-millisecond latency on 70k-line documents.
 */
export interface ArgumentSpan {
    index: number;
    text: string;
    from: number;
    to: number;
}
export interface EnclosingEventInfo {
    eventId: number;
    restBehavior: string;
    from: number;
    to?: number;
    /** Event parameter slots observed in this event, e.g. ["X0_4", "X4_4"]. */
    parameterSlots: string[];
}
export interface ActiveCallInfo {
    name: string;
    nameFrom: number;
    nameTo: number;
    openParenPos: number;
    closeParenPos?: number;
    activeArgumentIndex: number;
    arguments: ArgumentSpan[];
    isClosed: boolean;
}
export interface CurrentWordInfo {
    text: string;
    from: number;
    to: number;
}
export interface EventCursorContext {
    offset: number;
    lineNumber: number;
    columnNumber: number;
    isInComment: boolean;
    isInString: boolean;
    activeCall: ActiveCallInfo | null;
    enclosingEvent: EnclosingEventInfo | null;
    isInWaitFor: boolean;
    nestingDepth: number;
    currentWord: CurrentWordInfo | null;
}
/**
 * Analyze cursor context at the given character offset in the document.
 */
export declare function analyzeCursorContext(text: string, offset: number): EventCursorContext;
