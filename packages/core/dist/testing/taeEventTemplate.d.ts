/**
 * Development/validation-only parser for the public DSAnimStudio SDT XML.
 *
 * Production TAE reads use `FirstParty.TaeFirstPartySchema` in the Bridge.
 * This parser exists only to compare the checked-in first-party registry with
 * a locally available reference during development; it is deliberately kept
 * below `src/testing` and is never exported by the production barrel.
 */
export declare const TAE_EVENT_FIELD_KINDS: readonly ["s32", "u32", "f32", "s16", "u16", "s8", "u8", "b"];
export type TaeEventFieldKind = (typeof TAE_EVENT_FIELD_KINDS)[number];
export interface TaeEventTemplateField {
    name: string;
    kind: string;
    slotSize: number;
}
export interface TaeEventTemplateInfo {
    name: string;
    fields: TaeEventTemplateField[];
}
export interface TaeEventTemplateDiagnostic {
    severity: 'error' | 'info';
    code: string;
    message: string;
}
export interface TaeEventTemplateResult {
    ok: boolean;
    byEventTypeId: ReadonlyMap<number, TaeEventTemplateInfo>;
    eventCount: number;
    diagnostics: TaeEventTemplateDiagnostic[];
}
export declare function parseTaeEventTemplateXml(xml: string): TaeEventTemplateResult;
export declare function readTaeEventTemplateFile(path: string): Promise<TaeEventTemplateResult>;
