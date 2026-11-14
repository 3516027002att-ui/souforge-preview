export interface RankedItem {
    readonly id: string;
    readonly score: number;
}
export declare class RankingError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Best-first comparator with a locale-independent code-point tie break. */
export declare function compareRanked<T extends RankedItem>(left: T, right: T): number;
/**
 * Keep only the best k items.  The heap root is the worst retained item, so a
 * full scan costs O(n log k) and uses O(k) additional storage.
 */
export declare function topK<T extends RankedItem>(iterable: Iterable<T>, k: number): T[];
/** Strict cosine contract used by the vector retrieval path. */
export declare function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number;
/** Compatibility name for callers that previously imported the model client helper. */
export declare const cosineSimilarity: typeof cosine;
export declare function compareCodePointText(left: string, right: string): number;
