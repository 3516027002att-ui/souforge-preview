import type { ResourceFormatKind } from '@soulforge/shared';
export interface ResourceFileTypeInfo {
    extension: string;
    compoundExtension: string;
    formatKind: ResourceFormatKind;
    formatLabel: string;
}
export declare function detectResourceFileType(relativePath: string): ResourceFileTypeInfo;
