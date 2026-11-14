/**
 * DarkScript3 Document Semantic Snapshot & Windowed Service
 *
 * Provides sub-millisecond incremental access, viewport windowing, and
 * monotonic sequence tokens with cooperative cancellation for 50k+ line documents.
 */
import { indexDocumentSymbols } from "./eventSymbolIndexer.js";
import { computeDocumentDiagnostics } from "./eventDiagnosticsEngine.js";
export class SimpleCancellationTokenSource {
    _isCancelled = false;
    get token() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
            get isCancelled() {
                return self._isCancelled;
            }
        };
    }
    cancel() {
        this._isCancelled = true;
    }
}
export class DocumentSemanticSnapshot {
    version;
    text;
    lineCount;
    lineStarts;
    _symbolIndex = null;
    _eventRanges = null;
    constructor(text, version = 1) {
        this.text = text;
        this.version = version;
        const starts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10 /* \n */) {
                starts.push(i + 1);
            }
        }
        this.lineStarts = starts;
        this.lineCount = starts.length;
    }
    getLineOffset(line1Indexed) {
        if (line1Indexed <= 1)
            return 0;
        if (line1Indexed > this.lineStarts.length)
            return this.text.length;
        return this.lineStarts[line1Indexed - 1] ?? 0;
    }
    getLineNumber(offset) {
        if (offset <= 0)
            return 1;
        let low = 0;
        let high = this.lineStarts.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const start = this.lineStarts[mid];
            if (start === offset)
                return mid + 1;
            if (start < offset)
                low = mid + 1;
            else
                high = mid - 1;
        }
        return high + 1;
    }
    get symbolIndex() {
        if (!this._symbolIndex) {
            this._symbolIndex = indexDocumentSymbols(this.text);
        }
        return this._symbolIndex;
    }
    get eventRanges() {
        if (!this._eventRanges) {
            const idx = this.symbolIndex;
            const ranges = [];
            for (let i = 0; i < idx.symbols.length; i++) {
                const sym = idx.symbols[i];
                const nextSym = idx.symbols[i + 1];
                const to = nextSym ? nextSym.from : this.text.length;
                const lineStart = sym.line;
                const lineEnd = this.getLineNumber(to);
                ranges.push({
                    eventId: sym.eventId,
                    restBehavior: sym.restBehavior,
                    from: sym.from,
                    to,
                    lineStart,
                    lineEnd,
                    symbol: sym
                });
            }
            this._eventRanges = ranges;
        }
        return this._eventRanges;
    }
    getEventAt(offset) {
        const ranges = this.eventRanges;
        let low = 0;
        let high = ranges.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            const r = ranges[mid];
            if (offset >= r.from && offset < r.to)
                return r;
            if (offset < r.from)
                high = mid - 1;
            else
                low = mid + 1;
        }
        return null;
    }
    getEventsInWindow(startLine, endLine) {
        const startOffset = this.getLineOffset(startLine);
        const endOffset = this.getLineOffset(endLine + 1);
        return this.eventRanges.filter((r) => (r.from < endOffset && r.to > startOffset));
    }
    computeWindowDiagnostics(window, catalog, enums, cancellationToken) {
        if (cancellationToken?.isCancelled)
            return [];
        const events = this.getEventsInWindow(window.startLine, window.endLine);
        if (events.length === 0)
            return [];
        const diagnostics = [];
        for (const ev of events) {
            if (cancellationToken?.isCancelled)
                return [];
            const evText = this.text.slice(ev.from, ev.to);
            const evDiags = computeDocumentDiagnostics(evText, catalog, enums);
            for (const d of evDiags) {
                diagnostics.push({
                    ...d,
                    from: ev.from + d.from,
                    to: ev.from + d.to,
                    line: this.getLineNumber(ev.from + d.from),
                    ...(d.suggestedFixes
                        ? {
                            suggestedFixes: d.suggestedFixes.map((f) => ({
                                ...f,
                                from: ev.from + f.from,
                                to: ev.from + f.to
                            }))
                        }
                        : {})
                });
            }
        }
        return diagnostics;
    }
}
//# sourceMappingURL=documentSemanticSnapshot.js.map