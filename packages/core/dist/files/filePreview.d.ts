/**
 * Bounded file preview for Files Mode.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import { type FileCapabilityReport } from './fileCapabilities.js';
export interface FilePreviewResult {
    absolutePath: string;
    relativePath: string;
    size: number;
    bytesRead: number;
    truncated: boolean;
    previewKind: 'text' | 'hex' | 'empty';
    text?: string;
    hex?: string;
    capabilities: FileCapabilityReport;
    diagnostics: StructuredDiagnostic[];
    nativeFormatAuthority: false;
}
export declare function previewFileResource(input: {
    absolutePath: string;
    relativePath: string;
    maxBytes?: number;
}): Promise<FilePreviewResult>;
