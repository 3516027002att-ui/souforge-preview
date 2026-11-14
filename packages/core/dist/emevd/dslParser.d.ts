import type { EmevdDslDiagnostic, EmevdDslDocument } from '@soulforge/shared';
export declare function parseEmevdPatchDsl(source: string): {
    ast?: EmevdDslDocument;
    diagnostics: EmevdDslDiagnostic[];
};
