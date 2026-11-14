/**
 * SoulForge EMEVD semantic schema.  The C# Bridge remains the native binary
 * authority; this module only describes instruction arguments and performs
 * bounded typed projections/mutations.
 */
export type EmedfArgType = 'u8' | 's8' | 'u16' | 's16' | 'u32' | 's32' | 'f32' | 'bool';
export interface EmedfEnumMember {
    value: number;
    name: string;
    label?: string;
}
export interface EmedfEnumDef {
    name: string;
    members: EmedfEnumMember[];
}
export interface EmedfArgDef {
    name: string;
    type: EmedfArgType;
    /** Optional docs for UI. */
    description?: string;
    /** True when this arg repeats zero or more times (vararg tail). */
    vararg?: boolean;
    /** Name of the associated enum (e.g. "Comparison Type" or "ComparisonType"). */
    enumName?: string;
    default?: number;
    min?: number;
    max?: number;
    increment?: number;
    formatString?: string;
}
export interface EmedfInstructionDef {
    bank: number;
    id: number;
    name: string;
    args: EmedfArgDef[];
}
export interface EmedfRegistry {
    schemaVersion: 1;
    game: 'sekiro';
    origin: 'fixture' | 'user-derived' | 'imported' | 'first-party';
    /** Content-addressed provenance for a bundled first-party registry. */
    packageId?: string;
    packageVersion?: string;
    contentDigest?: `sha256:${string}`;
    /** All declared banks, including a bank that currently has no instructions. */
    banks?: number[];
    instructions: EmedfInstructionDef[];
    enums?: Record<string, EmedfEnumDef>;
}
export interface DecodedArg {
    name: string;
    type: EmedfArgType;
    value: number | boolean;
    startByte?: number;
    byteCount?: number;
    parameterSymbol?: string;
}
export type DecodeResult = {
    ok: true;
    def: EmedfInstructionDef;
    args: DecodedArg[];
} | {
    ok: false;
    code: string;
    message: string;
};
export type EncodeResult = {
    ok: true;
    args: Buffer;
} | {
    ok: false;
    code: string;
    message: string;
};
export type EmedfArgsValidationResult = {
    ok: true;
} | {
    ok: false;
    code: string;
    message: string;
};
export type EmedfRegistryValidationResult = EmedfArgsValidationResult;
/** Digest of instruction and enum semantics, excluding provenance fields. */
export declare function computeEmedfRegistryContentDigest(registry: EmedfRegistry): `sha256:${string}`;
/** Strict validation used by the bundled registry loader. */
export declare function validateFirstPartyEmedfRegistry(registry: EmedfRegistry): EmedfRegistryValidationResult;
/** Small built-in fixture covering common bank 2000 / 1000 patterns for smoke. */
export declare function createSekiroFixtureEmedf(): EmedfRegistry;
export declare function findInstructionDef(registry: EmedfRegistry, bank: number, id: number): EmedfInstructionDef | undefined;
/**
 * Decode raw instruction args with EMEDF layout.
 * Alignment: u16/s16 pad to 2, u32/s32/f32 pad to 4 (SoulsFormats style).
 */
export declare function decodeInstructionArgs(registry: EmedfRegistry, bank: number, id: number, args: Buffer): DecodeResult;
export declare function decodeEmedfArgs(def: EmedfInstructionDef, args: Buffer): DecodeResult;
/**
 * Collect event ID references from decoded instruction args.
 *
 * An arg is treated as an event ID reference when its name contains "eventId"
 * (DarkScript3-style naming, e.g. GotoEvent.eventId) or its description
 * mentions "event", and its decoded value is an integer. Schema-driven: any
 * imported EMEDF instruction with such an arg is covered automatically without
 * hardcoding bank/id. Returns undefined when the instruction has no schema.
 */
export declare function extractEventIdReferences(registry: EmedfRegistry, bank: number, id: number, decodedArgs: DecodedArg[]): number[] | undefined;
/**
 * Collect condition group references from decoded instruction args.
 *
 * An arg is treated as a condition group reference when its name contains
 * "conditionGroup" (e.g. conditionGroup, conditionGroupId,
 * resultConditionGroup, targetConditionGroup) or its description mentions
 * "condition group". Returns undefined when the instruction has no schema.
 */
export declare function extractConditionGroupReferences(registry: EmedfRegistry, bank: number, id: number, decodedArgs: DecodedArg[]): number[] | undefined;
/**
 * Collect condition group *result* references — the condition groups that an
 * instruction (e.g. IfConditionGroup's resultConditionGroup) defines for later
 * instructions to consume. These values form the "initialized" set in
 * control-flow validation. Returns undefined when the instruction has no schema.
 */
export declare function extractConditionGroupResults(registry: EmedfRegistry, bank: number, id: number, decodedArgs: DecodedArg[]): number[] | undefined;
export declare function encodeInstructionArgs(registry: EmedfRegistry, bank: number, id: number, values: Record<string, number | boolean>): EncodeResult;
export declare function encodeEmedfArgs(def: EmedfInstructionDef, values: Record<string, number | boolean>): EncodeResult;
/**
 * Apply a single named arg mutation onto existing raw args, preserving length when possible.
 *
 * Vararg instructions: only fixed (non-vararg) arguments can be mutated. The
 * original vararg tail bytes are preserved exactly (opaque-tail policy) and the
 * combined payload must stay equal-length, so Bridge in-place writes stay valid.
 */
export declare function mutateInstructionArg(registry: EmedfRegistry, bank: number, id: number, args: Buffer, argName: string, value: number | boolean): EncodeResult;
export declare function validateEmedfArgs(def: EmedfInstructionDef, values: Record<string, number | boolean>): EmedfArgsValidationResult;
/** Schema-claimed encoded length (with alignment and trailing padding) for a definition.
 *  For vararg instructions this is the *minimum* length (zero vararg repetitions). */
export declare function encodedEmedfArgsLength(def: EmedfInstructionDef): number;
/** True when the instruction has a trailing vararg parameter. */
export declare function hasVararg(def: EmedfInstructionDef): boolean;
/** Number of vararg repetitions that fit in `totalLength` bytes, or -1 if the length
 *  is invalid for this definition (too short or not a multiple of the vararg stride). */
export declare function varargCount(def: EmedfInstructionDef, totalLength: number): number;
/**
 * 校验 registry。结果按 registry 对象缓存（见 EmedfRegistryIndex 的语义前提）：
 * 同一个 registry 对象反复校验只付一次全量遍历成本。判据本身在
 * `validateEmedfRegistryUncached` 里，缓存不改变任何结论。
 */
export declare function validateEmedfRegistry(registry: EmedfRegistry): EmedfRegistryValidationResult;
export declare function align(offset: number, type: EmedfArgType): number;
export declare function alignmentOf(type: EmedfArgType): number;
export declare function encodedSize(args: EmedfArgDef[]): number;
export declare function byteLengthOf(type: EmedfArgType): number;
