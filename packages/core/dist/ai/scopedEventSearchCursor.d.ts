export interface ScopedEventSearchScope {
    workspaceId: string;
    file: string;
    query: string;
}
export declare function createScopedEventSearchCursor(scope: ScopedEventSearchScope, sourceHash: string, offset: number): string;
export declare function readScopedEventSearchCursor(cursor: string, workspaceId: string): {
    scope: {
        workspaceId: string;
        file: string;
        query: string;
    };
    sourceHash: string;
    offset: number;
} | undefined;
