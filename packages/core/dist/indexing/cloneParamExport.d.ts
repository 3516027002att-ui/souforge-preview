import type { ParamExport } from '@soulforge/shared';
/**
 * Clone one PARAM export without handing the complete row table to
 * structuredClone at once. Metadata and row scalar properties are copied as
 * data, fields are rebuilt as fresh arrays/objects, and raw/unknown mutable
 * properties retain the previous structured-clone semantics in bounded units.
 */
export declare function cloneParamExport(value: ParamExport): ParamExport;
/** Clone PARAM exports with no serializer input proportional to the full table. */
export declare function cloneParamExports(values: readonly ParamExport[]): ParamExport[];
