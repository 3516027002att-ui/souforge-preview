type SearchTool = 'search_param_rows' | 'search_text_entries' | 'search_tae_events';
/** A match's wording context: the query it came from plus the hint block a zero-hit page carries. */
export interface VariantHint {
    /** Always the data as stored, never the folded form. */
    text: string;
    [key: string]: unknown;
}
/**
 * 给一页搜索结果补上“这次是按哪个字形命中的”。
 *
 * - `normalizedQuery` 只在折叠真的改变了问句时出现：调用方据此知道自己给的繁体字被当成了简体。
 * - 零命中时不算完：`variantHints` 给出最接近的数据原文（等长、只差一个字），并把
 *   “可能用字不同，数据里写作 X” 写进 note / nextActions，而不是让「没有匹配」冒充「不存在」。
 *   这一类缺陷（用户写「绣丸」、数据写「锈丸」）繁简表救不了：两个字互不为繁简。
 */
export declare function withVariantContext<T extends {
    query: string;
    total: number;
}, S>(page: T, tool: SearchTool, suggest: (query: string) => S[], project: (hint: S) => VariantHint, note?: string): T & {
    normalizedQuery?: string;
    variantHints?: VariantHint[];
    nextActions?: Array<{
        tool: string;
        args: Record<string, unknown>;
        reason: string;
    }>;
    note?: string;
};
export declare function contentSearchPage<T>(options: {
    tool: SearchTool;
    workspaceId: string;
    input: Record<string, unknown>;
    search: (query: string, paramNames: string[]) => T[];
    fingerprint: (match: T) => unknown;
    /** Window used when the caller omits limit; a per-tool default, still capped by MAX_CONTENT_WINDOW. */
    defaultLimit?: number;
}): {
    nextActions: {
        tool: SearchTool;
        args: {
            cursor: string;
            paramNames?: string[];
            query?: string;
        };
        reason: string;
    }[];
    nextCursor?: string;
    query: string;
    matches: T[];
    total: number;
    totalCount: number;
    offset: number;
    limit: number;
    limitDefaulted: boolean;
    returned: number;
    returnedCount: number;
    truncated: boolean;
};
export {};
