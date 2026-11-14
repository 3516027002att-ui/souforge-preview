import type { ParamFieldDef } from '@soulforge/shared';
export interface MatrixFieldSpec {
    field: ParamFieldDef;
    value: number | string | boolean;
}
/**
 * Builds a deterministic multi-type field layout that fits within rowDataSize.
 * Contiguous from offset 0. Only types that fit are included, so small layouts
 * still get a meaningful subset and every write stays in bounds.
 */
export declare function deriveMatrixFieldSpecs(rowDataSize: number): MatrixFieldSpec[];
