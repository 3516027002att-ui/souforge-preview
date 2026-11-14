import type { EmevdDslCompileRequest, EmevdDslCompileResult, EmevdDslLiteral, EmevdEditorDocument } from '@soulforge/shared';
import type { EmedfArgType, EmedfRegistry } from './emedfSchema.js';
export declare function fingerprintEmedfRegistry(registry: EmedfRegistry): string;
export declare function compileEmevdPatchDsl(request: EmevdDslCompileRequest, document: EmevdEditorDocument, registry?: EmedfRegistry): EmevdDslCompileResult;
export declare function validateTypedLiteral(type: EmedfArgType, value: EmevdDslLiteral): {
    code: string;
    message: string;
} | undefined;
