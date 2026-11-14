/**
 * Unified resource capability matrix for Files Mode honesty.
 * Raw-level support is universal; semantic/native is never claimed without real writers.
 * Container-level fields for DCX/BND synthetic + DFLT.
 */
import type { Diagnostic, EditRiskLevel, IndexedFile, ResourceFormatKind } from '@soulforge/shared';
export type SemanticReadTier = 'none' | 'candidate' | 'partial' | 'fixture-confirmed' | 'authoritative';
export type CapabilityAvailability = 'available' | 'available_with_confirmation' | 'none';
export type ContainerReadableLevel = 'none' | 'candidate' | 'partial' | 'authoritative';
export type ContainerWritableLevel = 'none' | 'raw-replace' | 'child-replace' | 'authoritative-repack';
export type DecompressionStatus = 'none' | 'supported' | 'unsupported' | 'failed';
export type CompressionStatus = 'none' | 'supported' | 'unsupported' | 'failed';
export type SemanticAuthority = 'none' | 'candidate' | 'partial' | 'fixture-confirmed' | 'authoritative';
export interface ResourceCapabilityMatrix {
    sourceUri: string;
    absolutePath: string;
    relativePath: string;
    formatKind: ResourceFormatKind;
    resourceKind: IndexedFile['resourceKind'];
    openable: boolean;
    rawReadable: boolean;
    fullRawReadable: boolean;
    previewReadable: boolean;
    semanticReadable: boolean;
    semanticReadTier: SemanticReadTier;
    rawWritable: boolean;
    textWritable: boolean;
    binaryPatchWritable: boolean;
    semanticWritable: boolean;
    nativeRoundTripSafe: boolean;
    /** @deprecated prefer containerReadableLevel */
    containerReadable: boolean;
    /** @deprecated prefer containerWritableLevel */
    containerWritable: boolean;
    containerReadableLevel: ContainerReadableLevel;
    containerWritableLevel: ContainerWritableLevel;
    containerRoundTripSafe: boolean;
    canListChildren: boolean;
    canReadChild: boolean;
    canReplaceChild: boolean;
    canRepackContainer: boolean;
    decompressionStatus: DecompressionStatus;
    compressionStatus: CompressionStatus;
    childEditWritable: boolean;
    childEditRequiresConfirmation: boolean;
    semanticAuthorityByFormat?: Record<string, SemanticAuthority>;
    textCapability: CapabilityAvailability;
    rawCapability: CapabilityAvailability;
    semanticCapability: CapabilityAvailability;
    reasonCodes: string[];
    diagnostics: Diagnostic[];
    requiredConfirmation: boolean;
    riskLevel: EditRiskLevel;
    isTextLike: boolean;
    isPackedOrNative: boolean;
    nativeFormatAuthority: false;
}
export declare function isTextLikeIndexedFile(file: IndexedFile): boolean;
export declare function isPackedOrNativeIndexedFile(file: IndexedFile): boolean;
export interface ResolveCapabilitiesOptions {
    semanticReadTier?: SemanticReadTier;
    containerReadable?: boolean;
    /** When true, file is known synthetic SFBN BND (fixture-confirmed). */
    syntheticBnd?: boolean;
    /** When true, file is known DCX DFLT with full decompress. */
    dcxDfltSupported?: boolean;
    /** When true, nested DCX+BND synthetic roundtrip is safe. */
    nestedContainerRoundTripSafe?: boolean;
    /** FMG synthetic fixture confirmed. */
    syntheticFmg?: boolean;
}
/**
 * Compute honest capabilities for an indexed file.
 * Does not touch the filesystem unless caller passes probed options.
 */
export declare function resolveResourceCapabilities(file: IndexedFile, options?: ResolveCapabilitiesOptions): ResourceCapabilityMatrix;
/**
 * Probe file bytes and return capability options for resolveResourceCapabilities.
 */
export declare function probeContainerCapabilityOptions(absolutePath: string): Promise<ResolveCapabilitiesOptions>;
