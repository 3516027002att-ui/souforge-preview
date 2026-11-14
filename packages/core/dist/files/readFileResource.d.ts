/**
 * Read helpers for Files Mode (bounded by default).
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
export interface ReadFileResourceResult {
    absolutePath: string;
    relativePath: string;
    size: number;
    mode: 'bounded' | 'full_text' | 'full_bytes';
    bytesRead: number;
    contentHash?: string;
    text?: string;
    bytesBase64?: string;
    truncated: boolean;
    diagnostics: StructuredDiagnostic[];
    nativeFormatAuthority: false;
}
export declare function readFileResource(input: {
    absolutePath: string;
    relativePath: string;
    mode?: 'bounded' | 'full_text' | 'full_bytes';
    maxBytes?: number;
}): Promise<ReadFileResourceResult>;
