/**
 * PARAM field-level mutation helper.
 *
 * Applies a single field change to a row's byte payload using the
 * paramdef layout codec, then returns the modified row as base64
 * for a whole-row Bridge upsert.
 *
 * The Bridge remains a whole-row writer — field granularity is a
 * TypeScript-side concern.
 */
import type { ParamDefDocument } from '@soulforge/shared';
export interface ParamFieldMutationRequest {
    /** Current row data as base64. */
    rowDataBase64: string;
    /** The paramdef definition for this PARAM type. */
    definition: ParamDefDocument;
    /** The field ID to mutate. */
    fieldId: string;
    /** The new value for the field. */
    value: number | string | boolean;
}
export type ParamFieldMutationResult = {
    ok: true;
    nextDataBase64: string;
} | {
    ok: false;
    code: string;
    message: string;
};
/**
 * Apply a field-level mutation to a PARAM row.
 *
 * Decodes the base64 row data, applies the field change via
 * `encodeFieldMutation` (which handles both scalar and bitfield writes),
 * and returns the modified row as base64.
 */
export declare function applyParamFieldMutation(request: ParamFieldMutationRequest): ParamFieldMutationResult;
