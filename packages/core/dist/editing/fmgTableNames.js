/**
 * FMG 表名的规范形式。
 *
 * 读侧把用户的英文名（`ItemName`）解析成 BND 内的日文表名（`アイテム名`）并以此记录读取证明，
 * 写侧却直接拿调用方给的名字建键，于是「刚读过、马上写」被拒成 `NATIVE_READ_REQUIRED`。
 * 两侧都先过这个函数，键才对得上。
 */
const TABLE_ALIASES = {
    title: ['アイテム名', 'title_items', 'goodsname'],
    item: ['アイテム名'],
    itemname: ['アイテム名'],
    goods: ['アイテム名'],
    goodsname: ['アイテム名'],
    物品名: ['アイテム名'],
    道具名: ['アイテム名'],
    weapon: ['武器名'],
    weaponname: ['武器名'],
    武器名: ['武器名'],
    npc: ['NPC名'],
    npcname: ['NPC名'],
    character: ['NPC名'],
    charactername: ['NPC名'],
    人物名: ['NPC名'],
    角色名: ['NPC名'],
    敌人名: ['NPC名'],
    description: ['アイテム説明'],
    itemdesc: ['アイテム説明'],
    说明: ['アイテム説明'],
    道具说明: ['アイテム説明']
};
/** All spellings that refer to the same table, lowercased, canonical (native) name first. */
export function fmgTableNeedles(wanted) {
    const key = wanted.trim().toLowerCase();
    // search_text_entries returns a category like "engus/item/アイテム名" and callers feed it straight
    // back into read_fmg_entries or lookup_text_id, which take the bare table name. Accept the path
    // form by also trying its last segment and that segment's aliases.
    const lastSegment = key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : undefined;
    const aliases = [...(TABLE_ALIASES[key] ?? [])].map((item) => item.toLowerCase());
    const segmentAliases = lastSegment === undefined
        ? []
        : [...(TABLE_ALIASES[lastSegment] ?? [])].map((item) => item.toLowerCase());
    return [...new Set([
            key,
            ...(lastSegment === undefined ? [] : [lastSegment]),
            ...aliases,
            ...segmentAliases
        ])];
}
/** One spelling per table: the native BND name when the caller used a known alias. */
export function canonicalFmgTableName(table) {
    const needles = fmgTableNeedles(table);
    const native = TABLE_ALIASES[needles[0] ?? '']?.[0];
    return (native ?? table).trim().toLowerCase();
}
//# sourceMappingURL=fmgTableNames.js.map