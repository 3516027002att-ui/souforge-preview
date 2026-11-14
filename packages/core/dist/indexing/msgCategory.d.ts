/**
 * Indexed category identity for one FMG table inside a native MSG container.
 *
 * The Bridge export lowercases every category segment (`SafeCategory` in
 * `MsgTextExport.BuildNativeCategory`), so the index used to publish
 * `zhocn/item/npc名` and `zhocn/menu/ntc_メニューテキスト` while every direct
 * read (`read-text-catalog`, `read_fmg_entries`) returns the native spelling
 * `NPC名` / `NTC_メニューテキスト`.  Any consumer that groups search hits by
 * table name — the round-41 index coverage check did exactly that — therefore
 * reported six tables as "missing from the search index" even though all of
 * their entries were indexed.
 *
 * This helper rebuilds the category from the native BND4 entry name while
 * keeping the Bridge language/container prefix, so search and direct reads
 * name the same table with the same case.  Entries themselves are never
 * filtered here: every FMG table is indexed.
 */
export declare function nativeMsgCategory(sourceUri: string, entryName: string, bridgeCategory?: string): string;
