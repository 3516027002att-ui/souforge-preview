/**
 * Files Mode capability matrix for any overlay path.
 * Does not claim native structured edit for packed formats.
 */
import type { ResourceFormatKind, ResourceKind } from '@soulforge/shared';
export type FileWorkbenchCapability = 'read' | 'bounded_preview' | 'text_edit' | 'raw_edit' | 'whole_file_replace' | 'structured_edit' | 'none';
export interface FileCapabilityReport {
    relativePath: string;
    absolutePath: string;
    resourceKind: ResourceKind;
    formatKind: ResourceFormatKind;
    capabilities: FileWorkbenchCapability[];
    isTextLike: boolean;
    isPackedOrNative: boolean;
    isBinaryLike: boolean;
    structuredEditAllowed: boolean;
    writeRiskDefault: 'safe' | 'caution' | 'high' | 'blocked';
    nativeFormatAuthority: false;
    notes: string[];
}
export declare function compoundExtensionOf(relativePath: string): string;
export declare function formatKindFromPath(relativePath: string): ResourceFormatKind;
export declare function resourceKindFromPath(relativePath: string): ResourceKind;
export declare function isPackedOrNativeFormat(formatKind: ResourceFormatKind, relativePath: string): boolean;
export declare function isTextLikePath(relativePath: string): boolean;
export declare function getFileCapabilities(input: {
    absolutePath: string;
    relativePath: string;
    looksBinary?: boolean;
}): FileCapabilityReport;
