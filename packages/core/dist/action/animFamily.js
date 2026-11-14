/**
 * TAE/ANIBND animation naming rules: weapon family ↔ TAE entry ↔ animation identity.
 *
 * Why this module exists as its own file: the rule that produced it. Three places need the
 * same arithmetic — `read_tae_events` (label every action and TAE child), `explain_animation`
 * (find an animId across families, prove the families that do not have it), and any future
 * reader. The `agent-tool-modules` fixture requires each module under `ai/tools` to export
 * exactly one function, so a shared rule cannot live there; the rule is also not a PARAM-table
 * fact (unlike `param/weaponMotion.ts`), it is the ANIBND/TAE id layout, so it lives in
 * `action/` beside the other animation-identity code.
 *
 * The rules, established on real Sekiro containers (c0000.anibnd.dcx, 65 TAE children):
 *
 *   family            = EquipParamWeapon.wepmotionCategory (70000 -> 70 for the 手里剑 row;
 *                       the row *id* 70000 is not the family, the field value is)
 *   taeGroup          = 'a' + family padded to at least two digits   (70 -> a70, 5 -> a05)
 *   TAE child id      = 5_000_000 + family                          (a70.tae -> 5000070)
 *   animation id      = 1_000_000_000 + family * 1_000_000 + animId (a70 + A410000 -> 1070410000)
 *   native hkx name   = a{family:03}_{animId:06}.hkt                (a070_410000.hkt)
 *
 * Every function returns `null` rather than guessing when a value cannot be encoded: a family
 * that does not fit three digits, an animId that does not fit six, or an id below its base has
 * no defined spelling, and a caller must say "unknown" instead of inventing one.
 */
/** BND4 entry-id base of the TAE children inside an anibnd (a00.tae is 5,000,000). */
export const TAE_ENTRY_ID_BASE = 5_000_000;
/** BND4 entry-id base of the animation (hkt/hkx) children inside an anibnd. */
export const ANIMATION_ENTRY_ID_BASE = 1_000_000_000;
/** Animation ids are `family * 1,000,000 + animId`, so one family owns a 1,000,000-wide band. */
export const ANIMATION_FAMILY_STRIDE = 1_000_000;
/** `a{family:03}` has three digits, so a family above 999 has no native spelling. */
export const MAX_ANIM_FAMILY = 999;
/** `{animId:06}` has six digits, and the band is 1,000,000 wide. */
export const MAX_ANIM_ID = ANIMATION_FAMILY_STRIDE - 1;
/** A weapon family is a non-negative integer that fits `a{family:03}`. */
export function isAnimFamily(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_ANIM_FAMILY;
}
/** An animation id is a non-negative integer that fits `{animId:06}`. */
export function isAnimId(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_ANIM_ID;
}
/** `70 -> 'a70'`, `5 -> 'a05'`, `100 -> 'a100'`; `null` when the family has no spelling. */
export function taeGroupOfFamily(family) {
    return isAnimFamily(family) ? `a${String(family).padStart(2, '0')}` : null;
}
/** `70 -> 5000070`; `null` when the family has no spelling. */
export function taeEntryIdOfFamily(family) {
    return isAnimFamily(family) ? TAE_ENTRY_ID_BASE + family : null;
}
/** `5000070 -> 70`; `null` for any id outside the `5,000,000 + family` band. */
export function familyOfTaeEntryId(entryId) {
    if (typeof entryId !== 'number' || !Number.isSafeInteger(entryId))
        return null;
    const family = entryId - TAE_ENTRY_ID_BASE;
    return isAnimFamily(family) ? family : null;
}
/**
 * `'a70' | 'a070' | 'a70.tae' -> 70`. The group name carries the family with at least two
 * digits, so `a070` and `a70` are the same family and `a100` is 100, not 10 with a suffix.
 */
export function familyOfTaeGroup(group) {
    if (typeof group !== 'string')
        return null;
    const match = /^a(\d{2,3})(?:\.tae)?$/iu.exec(group.trim());
    if (match === null)
        return null;
    const family = Number(match[1]);
    return isAnimFamily(family) ? family : null;
}
/** `'a70.tae' -> 70`; a TAE child name is its group name plus `.tae`. */
export function familyOfTaeEntryName(name) {
    return typeof name === 'string' ? familyOfTaeGroup(name) : null;
}
/** `(70, 410000) -> 1070410000`; `null` when either part has no spelling. */
export function animationEntryIdOf(family, animId) {
    if (!isAnimFamily(family) || !isAnimId(animId))
        return null;
    return ANIMATION_ENTRY_ID_BASE + family * ANIMATION_FAMILY_STRIDE + animId;
}
/** `1070410000 -> {family: 70, animId: 410000}`; `null` outside the animation-entry band. */
export function decomposeAnimationEntryId(entryId) {
    if (typeof entryId !== 'number' || !Number.isSafeInteger(entryId))
        return null;
    const offset = entryId - ANIMATION_ENTRY_ID_BASE;
    if (offset < 0)
        return null;
    const family = Math.floor(offset / ANIMATION_FAMILY_STRIDE);
    const animId = offset % ANIMATION_FAMILY_STRIDE;
    return isAnimFamily(family) && isAnimId(animId) ? { family, animId } : null;
}
/** `(70, 410000) -> 'a070_410000.hkt'`; `null` when either part has no spelling. */
export function hkxNameOf(family, animId) {
    if (!isAnimFamily(family) || !isAnimId(animId))
        return null;
    return `a${String(family).padStart(3, '0')}_${String(animId).padStart(6, '0')}.hkt`;
}
/**
 * `'a070_410000.hkt' -> {family: 70, animId: 410000}`. The native extension varies (`.hkt`
 * is the animation container, `.hkx` appears in loose dumps), so both are accepted; anything
 * that is not exactly three family digits and six animId digits is rejected rather than
 * pattern-matched loosely.
 */
export function parseHkxName(name) {
    if (typeof name !== 'string')
        return null;
    const match = /^a(\d{3})_(\d{6})\.hk[t|x]$/iu.exec(name.trim());
    if (match === null)
        return null;
    const family = Number(match[1]);
    const animId = Number(match[2]);
    return isAnimFamily(family) && isAnimId(animId) ? { family, animId } : null;
}
/** Family-level identity: `70 -> {family: 70, taeGroup: 'a70', taeEntryId: 5000070}`. */
export function describeAnimFamily(family) {
    if (!isAnimFamily(family))
        return null;
    const taeGroup = taeGroupOfFamily(family);
    const taeEntryId = taeEntryIdOfFamily(family);
    return taeGroup === null || taeEntryId === null ? null : { family, taeGroup, taeEntryId };
}
/** Full animation identity: the four numbers/names a caller would otherwise compute by hand. */
export function describeAnimation(family, animId) {
    const base = describeAnimFamily(family);
    const animationEntryId = animationEntryIdOf(family, animId);
    const hkxName = hkxNameOf(family, animId);
    if (base === null || animationEntryId === null || hkxName === null)
        return null;
    return { ...base, animId, animationEntryId, hkxName };
}
/**
 * Read the family out of a TAE child record. The numeric entry id is the authority — the game
 * looks the child up by id — so it wins when the id and the name disagree; the disagreement is
 * returned instead of being hidden, because a renamed child would otherwise silently retarget
 * every animation lookup that goes through the name.
 *
 * Two wire shapes carry the same record: a TAE child directory entry calls the name `entryName`
 * and an animation calls it `taeEntryName`. Both are accepted so a caller never has to rename a
 * field (and silently lose the fallback) before asking.
 */
export function familyOfTaeEntry(entry) {
    const sources = [];
    const fromId = typeof entry.entryId === 'number' ? familyOfTaeEntryId(entry.entryId) : null;
    if (fromId !== null)
        sources.push('entry-id');
    const fromGroup = familyOfTaeGroup(entry.taeGroup);
    if (fromGroup !== null)
        sources.push('tae-group');
    const name = entry.entryName ?? entry.taeEntryName;
    const fromName = familyOfTaeEntryName(name);
    if (fromName !== null)
        sources.push('entry-name');
    const family = fromId ?? fromGroup ?? fromName;
    if (family === null)
        return null;
    const taeGroup = taeGroupOfFamily(family);
    const taeEntryId = taeEntryIdOfFamily(family);
    if (taeGroup === null || taeEntryId === null)
        return null;
    const named = [...new Set([fromId, fromGroup, fromName].filter((value) => value !== null))];
    const agrees = named.length <= 1;
    return {
        family,
        taeGroup,
        taeEntryId,
        sources,
        agrees,
        ...(agrees ? {} : { conflict: `条目 id 推出 family=${String(fromId)}，名称推出 ${named.filter((value) => value !== fromId).map((value) => `family=${String(value)}`).join('/')}；按条目 id 取值。` })
    };
}
//# sourceMappingURL=animFamily.js.map