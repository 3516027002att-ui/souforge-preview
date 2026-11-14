export interface CliToolDiagnosticInput {
    ok?: boolean;
    code?: string;
}
export interface CliToolDiagnosticDetails {
    ok: boolean;
    code?: string;
    cancelled?: boolean;
    underlyingCode?: string;
}
/**
 * Normalize the tool-level outcome at the session boundary.
 *
 * A tool may return an ordinary failure after its AbortSignal was observed
 * (for example, a reference scan can report REFERENCE_QUERY_FAILED while the
 * underlying scan is unwinding).  The CLI diagnostic describes the session
 * lifecycle, so cancellation must be the public code while retaining the
 * tool failure as an underlying diagnostic.
 */
export declare function normalizeCliToolDiagnostic(result: CliToolDiagnosticInput, signal?: AbortSignal): CliToolDiagnosticDetails;
