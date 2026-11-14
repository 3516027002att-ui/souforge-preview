/**
 * Apply / validate user-derived paramdef layouts against raw PARAM row bytes.
 * Does not parse native .paramdef binaries — that remains Bridge work.
 * 物理行身份由 rowIndex + expectedId + expectedDataHash 在 Bridge/IPC/Renderer 贯穿；
 * 本模块只负责字段在行字节内的编解码，不以 id 去重或 first-match。
 */
import type { ParamDefDocument, ParamFieldValue } from '@soulforge/shared';
export declare const PARAMDEF_MAX_FIELDS = 16384;
export declare const PARAMDEF_MAX_ENUMS = 4096;
export declare const PARAMDEF_MAX_ENUM_VALUES = 65536;
export interface ParamDefValidationResult {
    ok: boolean;
    diagnostics: Array<{
        severity: 'error' | 'warning';
        code: string;
        message: string;
    }>;
}
export declare function validateParamDef(doc: ParamDefDocument): ParamDefValidationResult;
/**
 * @deprecated Native row bytes are decoded by the Bridge (`read-param-document` with
 * `decodeFields`), which is the only production authority for a native format; this
 * TS decoder is a second implementation of the same rule and must not gain callers.
 *
 * `read_param_fields` no longer uses it: it projects `ParamDecodedCell`s returned by
 * the Bridge. What still calls it, and why it cannot be deleted in the same change:
 *
 * - `containerParamEdit.readFieldValue` — the PARAM **writer** computes the before/after
 *   values of the row bytes it is about to commit synchronously, and there is no Bridge
 *   primitive that decodes bytes which are not on disk yet. It maps this output into the
 *   Bridge's value domain (byte blobs, non-finite literals) so a post-commit reread and
 *   the receipt name the same value.
 * - `indexing/nativeSemanticRefresh.decodeNativeParamRows` — the semantic index decodes
 *   tens of thousands of rows per refresh with its own value-interning cache on top of a
 *   paged raw read; moving it to the Bridge needs a projection-aware decode primitive.
 * - `apps/desktop/src/main/services/paramService.ts` (CSV export) and the test/smoke
 *   fixtures — outside this change's file scope.
 *
 * Every one of those callers must move before this function goes away; until then the
 * two implementations can disagree on purpose (see below), and `compare/` only protects
 * the Bridge side.
 */
export declare function decodeRowFields(rowData: Buffer, def: ParamDefDocument): ParamFieldValue[];
export declare function encodeFieldMutation(rowData: Buffer, def: ParamDefDocument, fieldId: string, value: number | string | boolean): {
    ok: true;
    next: Buffer;
} | {
    ok: false;
    code: string;
    message: string;
};
