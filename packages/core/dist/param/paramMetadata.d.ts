import type { ParamDefDocument, ParamMetadataDefinition, ParamMetadataDefinitionKey, ParamMetadataDigest, ParamMetadataPackage, ParamMetadataTrustPolicy } from '@soulforge/shared';
/** Stable identity of the bundled SoulForge PARAM package. */
export declare const SOULFORGE_FIRST_PARTY_PARAM_PACKAGE_ID = "soulforge-sekiro-param";
export declare const SOULFORGE_FIRST_PARTY_PARAM_PACKAGE_VERSION = "1.0.0";
export declare const SOULFORGE_FIRST_PARTY_PARAM_SOURCE_IDENTITY = "soulforge://schema/sekiro/1.6.x/param";
/** Updated by the schema generator when the checked-in package changes. */
export declare const SOULFORGE_FIRST_PARTY_PARAM_PACKAGE_DIGEST: "sha256:e42fde9b453fad62490e0f6ee2bb9c34d37293313caf52b5df0f2747163d3daf";
export interface ParamMetadataDiagnostic {
    severity: 'error';
    code: string;
    path: string;
    message: string;
}
export type ParamMetadataPackageValidation = {
    ok: true;
    status: 'schema-valid';
    nativeFormatAuthority: false;
    package: ParamMetadataPackage;
    diagnostics: [];
} | {
    ok: false;
    status: 'rejected';
    nativeFormatAuthority: false;
    diagnostics: ParamMetadataDiagnostic[];
};
export type ParamMetadataMatchResult = {
    ok: true;
    status: 'matched';
    authority: 'fixture-confirmed' | 'partial';
    nativeFormatAuthority: false;
    definition: ParamMetadataDefinition;
    diagnostics: [];
} | {
    ok: false;
    status: 'rejected';
    authority: 'unverified';
    nativeFormatAuthority: false;
    diagnostics: ParamMetadataDiagnostic[];
};
export type ParamMetadataOverlayResult = {
    ok: true;
    status: 'applied';
    authority: 'fixture-confirmed' | 'partial';
    nativeFormatAuthority: false;
    document: ParamDefDocument;
    baseDefinitionDigest: ParamMetadataDigest;
    effectiveDefinitionDigest: ParamMetadataDigest;
    diagnostics: [];
} | {
    ok: false;
    status: 'rejected';
    authority: 'unverified';
    nativeFormatAuthority: false;
    diagnostics: ParamMetadataDiagnostic[];
};
export declare const PARAM_METADATA_MAX_DEFINITIONS = 4096;
export declare const PARAM_METADATA_MAX_TRUST_ENTRIES = 4096;
export declare const PARAM_METADATA_MAX_OVERLAY_OPERATIONS = 4096;
export declare const PARAM_METADATA_MAX_TOTAL_FIELDS = 131072;
export declare const PARAM_METADATA_MAX_TOTAL_ENUMS = 32768;
export declare const PARAM_METADATA_MAX_TOTAL_ENUM_VALUES = 524288;
export declare const PARAM_METADATA_MAX_CANONICAL_UTF8_BYTES: number;
export declare const PARAM_METADATA_MAX_DIAGNOSTICS = 256;
/** Hashes trusted in-memory data. Untrusted external values must pass validation first. */
export declare function computeParamMetadataDigest(value: unknown): ParamMetadataDigest;
export declare function computeParamMetadataDefinitionDigest(definition: Omit<ParamMetadataDefinition, 'definitionDigest'> | ParamMetadataDefinition): ParamMetadataDigest;
export declare function computeParamMetadataPackageDigest(metadataPackage: Omit<ParamMetadataPackage, 'packageDigest'> | ParamMetadataPackage): ParamMetadataDigest;
export declare function validateParamMetadataPackage(input: unknown): ParamMetadataPackageValidation;
/** A width hint for native parsing, not a native-read receipt or write authority. */
export declare function resolveParamMetadataRowWidth(metadata: ParamMetadataPackage, descriptor: Omit<ParamMetadataDefinitionKey, 'rowDataSize'>, trustPolicy?: ParamMetadataTrustPolicy): number | undefined;
export declare function matchParamMetadataPackage(input: unknown, descriptor: ParamMetadataDefinitionKey, trustPolicy: unknown): ParamMetadataMatchResult;
export declare function applyParamMetadataOverlay(packageInput: unknown, overlayInput: unknown, trustPolicy: unknown): ParamMetadataOverlayResult;
