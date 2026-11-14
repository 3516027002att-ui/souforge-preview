import type { EmevdDslDiagnostic, EmevdDslSourceSpan } from '@soulforge/shared';
export declare const EMEVD_DSL_MAX_SOURCE_BYTES: number;
export declare const EMEVD_DSL_MAX_TOKENS = 20000;
export declare const EMEVD_DSL_MAX_NESTING_DEPTH = 16;
export type EmevdDslTokenKind = 'identifier' | 'number' | 'string' | 'anchor' | 'lbrace' | 'rbrace' | 'equals' | 'semicolon' | 'eof';
export interface EmevdDslToken {
    kind: EmevdDslTokenKind;
    value: string;
    span: EmevdDslSourceSpan;
}
export declare function createEmevdDslDiagnostic(code: string, message: string, span: EmevdDslSourceSpan, extra?: {
    resourceUri?: string;
    targetAnchor?: string;
}): EmevdDslDiagnostic;
export declare function compareEmevdDslDiagnostics(a: EmevdDslDiagnostic, b: EmevdDslDiagnostic): number;
export declare function tokenizeEmevdDsl(source: string): {
    tokens: EmevdDslToken[];
    diagnostics: EmevdDslDiagnostic[];
};
