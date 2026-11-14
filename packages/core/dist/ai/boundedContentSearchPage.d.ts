/** Provider-owned paging: cursor identity includes its versioned ordering contract. */
export declare function boundedContentSearchPage<T>(options: {
    tool: 'search_tae_events';
    workspaceId: string;
    provider: string;
    input: Record<string, unknown>;
    readPage(query: string, window: {
        offset: number;
        limit: number;
        continuation?: string;
    }): {
        matches: T[];
        total: number;
        snapshotId: string;
        continuation?: string;
    };
}): {
    nextActions: {
        tool: "search_tae_events";
        args: Record<string, unknown>;
        reason: string;
    }[];
    nextCursor?: string;
    query: string;
    matches: T[];
    total: number;
    totalCount: number;
    offset: number;
    limit: number;
    returned: number;
    returnedCount: number;
    truncated: boolean;
    coverage: "indexed-snapshot";
};
