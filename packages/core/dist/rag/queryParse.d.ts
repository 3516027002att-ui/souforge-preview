export interface ParsedRagQuery {
    raw: string;
    terms: string[];
    phrases: string[];
    numericIds: number[];
    uris: string[];
}
export declare function parseRagQuery(raw: string): ParsedRagQuery;
/** 连续 CJK 片段切 2 字 bigram；非 CJK 字符打断片段。 */
export declare function cjkBigrams(value: string): string[];
export declare function tokenize(value: string): string[];
