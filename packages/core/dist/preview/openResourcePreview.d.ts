import type { IndexedFile, ResourcePreview } from '@soulforge/shared';
export interface OpenResourcePreviewOptions {
    file: IndexedFile;
    maxBytes?: number;
    inspectNative?: boolean;
    parseStructured?: boolean;
    bridgeProjectPath?: string;
    bridgeTimeoutMs?: number;
    /** Main-owned Sekiro installation root; never sourced from renderer input. */
    oodleRuntimeRoot?: string;
}
export declare function openResourcePreview(options: OpenResourcePreviewOptions): Promise<ResourcePreview>;
