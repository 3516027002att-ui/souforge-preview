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
export function nativeMsgCategory(sourceUri, entryName, bridgeCategory = '') {
    const table = nativeTableName(entryName);
    if (table.length === 0)
        return bridgeCategory;
    const prefix = bridgeCategory.includes('/')
        ? bridgeCategory.slice(0, bridgeCategory.lastIndexOf('/'))
        : sourceContainerPrefix(sourceUri);
    return prefix.length > 0 ? `${prefix}/${table}` : table;
}
function nativeTableName(entryName) {
    const leaf = entryName.replaceAll('\\', '/').split('/').pop() ?? entryName;
    return leaf.replace(/\.fmg$/iu, '').trim();
}
/**
 * `file:///ws/msg/zhocn/menu.msgbnd.dcx` → `zhocn/menu`.
 * Mirrors the Bridge prefix (language directory + container stem) without
 * lowercasing the FMG table name, which is appended by the caller.
 */
function sourceContainerPrefix(sourceUri) {
    const normalized = sourceUri.replaceAll('\\', '/');
    const marker = normalized.toLowerCase().lastIndexOf('/msg/');
    if (marker < 0)
        return '';
    const parts = normalized.slice(marker + '/msg/'.length).split('/').filter(Boolean);
    if (parts.length < 2)
        return '';
    const language = parts[0];
    const container = (parts[1].split('/').pop() ?? parts[1])
        .replace(/\.dcx$/iu, '')
        .replace(/\.(?:msgbnd|fmg|msg)$/iu, '');
    return `${language}/${container}`;
}
//# sourceMappingURL=msgCategory.js.map