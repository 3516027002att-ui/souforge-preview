/**
 * Metadata-only registry contract for the REL-B release corpus.
 *
 * The registry never contains sample bytes or local paths. Validation only
 * proves that metadata is classifiable; it does not grant native authority.
 */
export declare const RELEASE_CORPUS_REGISTRY_SCHEMA_VERSION: "1.1.0";
/**
 * registry 的 schemaVersion 是否可被本实现读取。
 *
 * 规则（spec §3）：同 MAJOR 且 MINOR/PATCH 不超过当前版本即可读。
 * 同一 MAJOR 内的提升都是兼容扩展（新增枚举、放宽约束、新增可选字段），
 * 所以旧 registry 必须继续合法；而来自**更高**版本的 registry 要拒绝，
 * 因为它可能携带本实现不认识的枚举值，放行等于静默接受未知约束。
 */
export declare function isReadableSchemaVersion(version: unknown): boolean;
/** Maximum entry count for one registry shard. Larger corpora must be split out of repo. */
export declare const RELEASE_CORPUS_MAX_ENTRIES = 10000;
export declare const RELEASE_CORPUS_GAMES: readonly ["sekiro"];
export declare const RELEASE_CORPUS_FORMATS: readonly ["DFLT", "BND4", "KRAK"];
export declare const RELEASE_CORPUS_OBSERVED_VARIANTS_BY_FORMAT: {
    readonly DFLT: readonly ["DCX_DFLT_10000_24_9", "DCX_DFLT_10000_24_9_0", "DCX_DFLT_10000_44_9", "DCX_DFLT_10000_44_9_0", "DCX_DFLT_11000_44_8", "DCX_DFLT_11000_44_9", "DCX_DFLT_11000_44_9_0", "DCX_DFLT_11000_44_9_15"];
    readonly BND4: readonly ["BND4_40_24"];
    readonly KRAK: readonly ["DCX_KRAK_6", "DCX_KRAK_9", "DCX_KRAK_11000_44_6_0"];
};
/**
 * Frozen machine-readable spec authority: packages/core/src/bridge/releaseCorpusRegistry.schema.json.
 * The constants below must match the schema's `x-constants` block value-for-value;
 * test:release-corpus-registry enforces that sync gate. Changing an enum here without
 * bumping the schema (or vice versa) fails closed.
 */
export declare const RELEASE_CORPUS_OPERATIONS: readonly ["classify", "read", "no-op-roundtrip", "mutate", "repack", "reread", "preserve-unknown-fields"];
export declare const RELEASE_CORPUS_PRIVACY_CLASSES: readonly ["private-game-asset", "private-user-mod", "public-redistributable"];
export declare const RELEASE_CORPUS_EXPECTED_AUTHORITIES: readonly ["unsupported", "candidate", "partial", "native-verified", "unverified"];
export declare const RELEASE_CORPUS_RESOURCE_KINDS: readonly ["event", "map", "param", "msg", "menu", "script", "action", "ai", "sfx", "chr", "obj", "other"];
/**
 * Bridge `read-dcx-document` `data.variant` 输出的冻结闭集，由 observedVariant
 * 闭集按约定（DFLT/KRAK 去掉 `DCX_` 前缀）推导。native 对账门禁用它判定任何
 * Bridge 输出的信封变体都必须是已冻结分类，未识别变体即失败关闭。
 */
export declare const RELEASE_CORPUS_BRIDGE_ENVELOPE_VARIANTS: readonly string[];
/**
 * registry `observedVariant` → Bridge `data.variant`（DCX 信封变体）。
 * `BND4` 的 `observedVariant`（`BND4_40_24`）来自内嵌 BND4 header 布局而非 DCX
 * 信封，没有对应的 envelope variant，返回 null。
 */
export declare function observedVariantToBridgeVariant(format: ReleaseCorpusFormat, observedVariant: ReleaseCorpusObservedVariant): string | null;
/** Bridge 信封变体是否属于已冻结闭集（native 对账门禁的判定函数）。 */
export declare function isBridgeEnvelopeVariant(bridgeVariant: string): boolean;
export type ReleaseCorpusGame = (typeof RELEASE_CORPUS_GAMES)[number];
export type ReleaseCorpusFormat = (typeof RELEASE_CORPUS_FORMATS)[number];
export type ReleaseCorpusObservedVariant = (typeof RELEASE_CORPUS_OBSERVED_VARIANTS_BY_FORMAT)[ReleaseCorpusFormat][number];
export type ReleaseCorpusOperation = (typeof RELEASE_CORPUS_OPERATIONS)[number];
export type ReleaseCorpusPrivacyClass = (typeof RELEASE_CORPUS_PRIVACY_CLASSES)[number];
export type ReleaseCorpusExpectedAuthority = (typeof RELEASE_CORPUS_EXPECTED_AUTHORITIES)[number];
export type ReleaseCorpusResourceKind = (typeof RELEASE_CORPUS_RESOURCE_KINDS)[number];
export interface ReleaseCorpusRegistryEntry {
    /** Opaque, redacted identity. It must not be a filesystem path. */
    logicalId: string;
    sha256: string;
    size: number;
    /** Relative in-game logical identifiers only; never local filesystem paths. */
    containerChain: string[];
    resourceKind: ReleaseCorpusResourceKind;
    format: ReleaseCorpusFormat;
    /** Closed observed variant enum matching the current Bridge classification boundary. */
    observedVariant: ReleaseCorpusObservedVariant;
    permittedOperations: ReleaseCorpusOperation[];
    /** Requested validation target, not authority granted by this registry. */
    expectedAuthority: ReleaseCorpusExpectedAuthority;
    privacyClass: ReleaseCorpusPrivacyClass;
}
export interface ReleaseCorpusRegistry {
    registryId: string;
    game: ReleaseCorpusGame;
    gameBuild: string;
    schemaVersion: typeof RELEASE_CORPUS_REGISTRY_SCHEMA_VERSION;
    createdAt: string;
    entryCount: number;
    entries: ReleaseCorpusRegistryEntry[];
}
export interface ReleaseCorpusRegistryDiagnostic {
    severity: 'error';
    code: string;
    path: string;
    message: string;
}
export interface ReleaseCorpusClassificationSummary {
    formatCounts: Record<ReleaseCorpusFormat, number>;
    observedVariantCounts: Record<string, number>;
}
export type ReleaseCorpusRegistryValidation = {
    ok: true;
    status: 'schema-valid';
    nativeFormatAuthority: false;
    registry: ReleaseCorpusRegistry;
    classification: ReleaseCorpusClassificationSummary;
    diagnostics: [];
} | {
    ok: false;
    status: 'rejected';
    nativeFormatAuthority: false;
    classification: ReleaseCorpusClassificationSummary;
    diagnostics: ReleaseCorpusRegistryDiagnostic[];
};
export declare function validateReleaseCorpusRegistry(input: unknown): ReleaseCorpusRegistryValidation;
