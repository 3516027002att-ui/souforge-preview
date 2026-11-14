/** Exact, case-sensitive source search. Scans at most a page plus one lookahead; no full hit-list allocation. */
export declare function literalSourceSearchPage(input: {
    text: string;
    sourceKey: string;
    sourceHash: string;
    query: string;
    cursor?: string;
    limit?: number;
}): {
    nextCursor?: string;
    query: string;
    matches: {
        sourceOffset: number;
        matchOffset: number;
        line: number;
        snippet: string;
    }[];
    returned: number;
    returnedCount: number;
    limit: number;
    hasMore: boolean;
    truncated: boolean;
    searchComplete: boolean;
    scan: {
        offset: number;
        nextOffset: number;
        complete: boolean;
    };
};
