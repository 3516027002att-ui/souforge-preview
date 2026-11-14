/**
 * Indexed MSG category identity revision.
 *
 * v1 keeps the native FMG table spelling (`NPC名`, `NTC_メニューテキスト`) in
 * the category instead of the Bridge's lowercased `SafeCategory` form.  A
 * cached bundle produced before this rule is not reusable: its category names
 * cannot be matched against native table names, which is what made the
 * round-41 coverage check report six tables as missing from the search index.
 */
export const MSG_CATEGORY_PROJECTION_VERSION = 1;
/**
 * 动作（TAE）投影（问题 6-C）。source 'action' 资源经 read-tae-document 信封
 * 投影而来，chrId 从文件路径提取（cXXXX）。词条 symbolUri 为
 * `action://<chr>/<AXXXX>/<eN>`。
 */
/** Native TAE ID/entry pairing revision; independent of file hashes and event schemas. */
export const TAE_IDENTITY_PROJECTION_VERSION = 2;
//# sourceMappingURL=resourceSymbols.js.map