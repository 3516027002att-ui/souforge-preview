/** All spellings that refer to the same table, lowercased, canonical (native) name first. */
export declare function fmgTableNeedles(wanted: string): string[];
/** One spelling per table: the native BND name when the caller used a known alias. */
export declare function canonicalFmgTableName(table: string): string;
