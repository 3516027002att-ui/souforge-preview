/**
 * Structured diagnostics for safety gates (architecture forks #109, #151 area).
 * Extends the lightweight Diagnostic used across the product with URI / provenance hooks.
 */
export function toLegacyDiagnostic(item) {
    const diagnostic = {
        severity: item.severity,
        code: String(item.code),
        message: item.message
    };
    if (item.sourceUri !== undefined)
        diagnostic.sourceUri = item.sourceUri;
    else if (item.targetUri !== undefined)
        diagnostic.sourceUri = item.targetUri;
    if (item.details !== undefined)
        diagnostic.details = item.details;
    return diagnostic;
}
export function fromLegacyDiagnostic(item) {
    const diagnostic = {
        severity: item.severity,
        code: item.code,
        message: item.message
    };
    if (item.sourceUri !== undefined) {
        diagnostic.sourceUri = item.sourceUri;
        diagnostic.targetUri = item.sourceUri;
    }
    if (item.details !== undefined)
        diagnostic.details = item.details;
    return diagnostic;
}
export function createDiagnostic(partial) {
    const diagnostic = {
        severity: partial.severity,
        code: partial.code,
        message: partial.message,
        recordedAt: partial.recordedAt ?? new Date().toISOString()
    };
    if (partial.targetUri !== undefined)
        diagnostic.targetUri = partial.targetUri;
    if (partial.sourceUri !== undefined)
        diagnostic.sourceUri = partial.sourceUri;
    if (partial.provenance !== undefined)
        diagnostic.provenance = partial.provenance;
    if (partial.confidence !== undefined)
        diagnostic.confidence = partial.confidence;
    if (partial.details !== undefined)
        diagnostic.details = partial.details;
    return diagnostic;
}
export function hasErrorDiagnostics(items) {
    return items.some((item) => item.severity === 'error');
}
export function collectDiagnosticCodes(items) {
    return [...new Set(items.map((item) => String(item.code)))];
}
//# sourceMappingURL=diagnostics.js.map