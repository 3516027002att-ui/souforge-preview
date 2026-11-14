import type { ParamMetadataPackage } from '@soulforge/shared';
export interface SmithboxSdtSourcePolicy {
    policyId: string;
    release: string;
    sourceIdentity: string;
    sourceCommit: string;
    archiveFileName: string;
    archiveSize: number;
    archiveSha256: string;
    sourceTreeFileCount: number;
    sourceTreeSha256: string;
    smithboxLicenseSha256: string;
    expectedDefinitionCount: number;
    gameBuild: string;
}
export declare const SMITHBOX_SDT_2_2_4_POLICY: Readonly<SmithboxSdtSourcePolicy>;
export interface SmithboxSdtImportOptions {
    /** Exact release slot, normally .../SoulForge/tools/smithbox/2.2.4. */
    cacheRoot: string;
    /** Application-owned withdrawal list; renderer input must never populate it. */
    revokedArtifactDigests?: readonly string[];
}
export interface SmithboxSdtImportDiagnostic {
    severity: 'error';
    code: string;
    message: string;
}
export type SmithboxSdtImportResult = {
    ok: true;
    status: 'imported';
    authority: 'partial';
    nativeFormatAuthority: false;
    package: ParamMetadataPackage;
    summary: {
        policyId: string;
        release: string;
        definitionCount: number;
        fieldCount: number;
        resolvedEnumCount: number;
        unresolvedEnumCount: number;
        annotationCount: number;
        /** 带跨表引用的字段数（实测本发布 450）。 */
        refFieldCount: number;
    };
    diagnostics: [];
} | {
    ok: false;
    status: 'rejected';
    authority: 'unverified';
    nativeFormatAuthority: false;
    diagnostics: SmithboxSdtImportDiagnostic[];
};
/** Production entrypoint. Its source identity and digests cannot be overridden. */
export declare function importPinnedSmithboxSdtParamMetadata(options: SmithboxSdtImportOptions): Promise<SmithboxSdtImportResult>;
/**
 * Explicit policy boundary used by deterministic fixtures and future reviewed
 * upgrades. Production callers must use importPinnedSmithboxSdtParamMetadata.
 */
export declare function importSmithboxSdtParamMetadata(options: SmithboxSdtImportOptions, policy: Readonly<SmithboxSdtSourcePolicy>): Promise<SmithboxSdtImportResult>;
