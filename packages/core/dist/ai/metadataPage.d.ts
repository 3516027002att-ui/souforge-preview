/** Pages an already parsed, finite metadata collection without losing a row to transport trimming. */
export declare function metadataPage<T>(options: {
    items: readonly T[];
    scope: unknown;
    sourceHash: string;
    domain: 'param' | 'script';
    cursor?: string;
    limit?: number;
}): {
    nextCursor?: string;
    items: T[];
    total: number;
    totalCount: number;
    offset: number;
    limit: number;
    returned: number;
    returnedCount: number;
    truncated: boolean;
};
