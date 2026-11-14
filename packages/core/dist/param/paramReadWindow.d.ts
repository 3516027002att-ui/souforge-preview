/** Expose a container only as a workspace-relative URI, never a host path. */
export declare function paramContainerRecoveryUri(overlayRoot: string, containerPath: string): string | undefined;
/** A page is complete only when rows, requested fields, and all result pages were delivered. */
export declare function paramReadCoverage(input: {
    missingRows: number;
    missingFields: number;
    hasMore: boolean;
}): {
    complete: boolean;
    status: 'complete' | 'partial';
};
export interface ParamReadDelivery {
    /** Always `read`: the numbers below cover cell 0 through the end of this page. */
    scope: 'read';
    /** Zero-based index of the first cell this page delivered. */
    cellOffset: number;
    /** Exclusive upper bound of the cells this read has delivered so far. */
    cellsDeliveredThrough: number;
    totalCells: number;
    /** Requested rows in request order, with the cells delivered for each so far. */
    deliveredRowCounts: Array<{
        rowId: number;
        delivered: number;
    }>;
    /** Requested field ids this read has not delivered any cell for yet. */
    undeliveredFieldIds: string[];
}
/**
 * What this delivery has covered **from the first cell of the read through the end of this page**.
 *
 * A continuation page used to be scored as if it were the whole read: page 2 of a 54-cell read
 * re-listed the rows page 1 had already delivered, so two pages that together deliver everything
 * reported `completeness=partial` on the second page. The position is already known without any
 * cross-process state — `offset` (or the cursor that encodes it) is an index into the same stable
 * cell list `pagination.totalCount` counts, and the cursor's scope hash pins table/rows/fields and
 * their order. So "cells 0..offset-1 were delivered by earlier pages" is a fact of the request, not
 * a guess, and the cumulative answer is reproducible in a new process.
 *
 * `deliveredCount` is this page's cell count, never a caller-supplied total: the cumulative boundary
 * is `offset + deliveredCount` and can never exceed the collection.
 */
export declare function paramReadDelivery<T extends {
    fieldId: string;
    row: {
        id: number;
    };
}>(input: {
    cells: readonly T[];
    /** Zero-based index of the first cell this page delivered. */
    offset: number;
    /** Cells this page actually delivered (the window can end before `pageSize`). */
    deliveredCount: number;
    /** Field ids in request order, deduplicated; the denominator of "field delivered at all". */
    requestedFieldIds: readonly string[];
    /** Row ids in request order, deduplicated; the rows `rowsNotFullyDelivered` may name. */
    requestedRowIds: readonly number[];
}): ParamReadDelivery;
/** Mixed documents bind hashes to their physical children, not an unordered hash set. */
export declare function paramReadSourceHash(cells: readonly {
    table: string;
    entryIndex: number;
    sourceHash: string;
}[]): string;
/** Scope binds the complete request without copying its paths/field list into every cursor. */
export declare function paramReadWindow<T extends {
    table: string;
    fieldId: string;
}, D>(input: {
    cells: readonly T[];
    definitions: ReadonlyMap<string, D>;
    legacyScope: string;
    sourceHash: string;
    pageSize: number;
    cellIdentity: (cell: T) => unknown;
    cursor?: string;
    /**
     * Zero-based index into the same stable cell collection `pagination.totalCount` counts, i.e. the
     * position an opaque cursor encodes. `offset + pageSize` therefore reproduces the next page that
     * `nextCursor` would have delivered. It is a second entry point to one window, not a second window:
     * both spellings select the same cells and emit the same `queryScope`/`nextCursor`.
     */
    offset?: number;
}): {
    items: T[];
    offset: number;
    nextCursor: string | null;
    queryScope: string;
    fieldDefinitions: D[];
};
