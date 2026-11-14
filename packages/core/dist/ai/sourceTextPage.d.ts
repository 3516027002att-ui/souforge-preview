import { type NativeEditDomain } from '@soulforge/shared';
export interface SourceTextPageOptions {
    text: string;
    sourceKey: string;
    sourceHash: string;
    domain: NativeEditDomain;
    sourceOffset?: number;
    sourceLimit?: number;
    cursor?: string;
    /**
     * Per-call overrides. The defaults below suit a prose entry; a standalone script
     * is read as one document, where a 2400-character preview is a different tool.
     * Callers that raise these must keep the page inside the 64 KiB Agent envelope.
     */
    defaultLimit?: number;
    maxLimit?: number;
    jsonBudget?: number;
}
/** Read-only source windows. Offsets are UTF-16 positions; never split a surrogate pair. */
export declare function sourceTextPage(options: SourceTextPageOptions): {
    nextCursor?: string;
    fullUtf8Bytes: number;
    pageStartByte: number;
    pageEndByte: number;
    fullTextHash: string;
    effectiveLimit?: number;
    limitClampedBy?: "json-budget";
    sourceText: string;
    sourceTextComplete: boolean;
    total: number;
    totalCount: number;
    offset: number;
    limit: number;
    returned: number;
    returnedCount: number;
    truncated: boolean;
    hasMore: boolean;
    startLine: number;
    endLine: number;
};
