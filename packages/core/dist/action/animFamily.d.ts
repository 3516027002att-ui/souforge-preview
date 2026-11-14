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
export declare const TAE_ENTRY_ID_BASE = 5000000;
/** BND4 entry-id base of the animation (hkt/hkx) children inside an anibnd. */
export declare const ANIMATION_ENTRY_ID_BASE = 1000000000;
/** Animation ids are `family * 1,000,000 + animId`, so one family owns a 1,000,000-wide band. */
export declare const ANIMATION_FAMILY_STRIDE = 1000000;
/** `a{family:03}` has three digits, so a family above 999 has no native spelling. */
export declare const MAX_ANIM_FAMILY = 999;
/** `{animId:06}` has six digits, and the band is 1,000,000 wide. */
export declare const MAX_ANIM_ID: number;
/** A weapon family is a non-negative integer that fits `a{family:03}`. */
export declare function isAnimFamily(value: unknown): value is number;
/** An animation id is a non-negative integer that fits `{animId:06}`. */
export declare function isAnimId(value: unknown): value is number;
/** `70 -> 'a70'`, `5 -> 'a05'`, `100 -> 'a100'`; `null` when the family has no spelling. */
export declare function taeGroupOfFamily(family: number): string | null;
/** `70 -> 5000070`; `null` when the family has no spelling. */
export declare function taeEntryIdOfFamily(family: number): number | null;
/** `5000070 -> 70`; `null` for any id outside the `5,000,000 + family` band. */
export declare function familyOfTaeEntryId(entryId: number): number | null;
/**
 * `'a70' | 'a070' | 'a70.tae' -> 70`. The group name carries the family with at least two
 * digits, so `a070` and `a70` are the same family and `a100` is 100, not 10 with a suffix.
 */
export declare function familyOfTaeGroup(group: string | undefined): number | null;
/** `'a70.tae' -> 70`; a TAE child name is its group name plus `.tae`. */
export declare function familyOfTaeEntryName(name: string | undefined): number | null;
/** `(70, 410000) -> 1070410000`; `null` when either part has no spelling. */
export declare function animationEntryIdOf(family: number, animId: number): number | null;
/** `1070410000 -> {family: 70, animId: 410000}`; `null` outside the animation-entry band. */
export declare function decomposeAnimationEntryId(entryId: number): {
    family: number;
    animId: number;
} | null;
/** `(70, 410000) -> 'a070_410000.hkt'`; `null` when either part has no spelling. */
export declare function hkxNameOf(family: number, animId: number): string | null;
/**
 * `'a070_410000.hkt' -> {family: 70, animId: 410000}`. The native extension varies (`.hkt`
 * is the animation container, `.hkx` appears in loose dumps), so both are accepted; anything
 * that is not exactly three family digits and six animId digits is rejected rather than
 * pattern-matched loosely.
 */
export declare function parseHkxName(name: string): {
    family: number;
    animId: number;
} | null;
export interface AnimFamilyIdentity {
    family: number;
    /** `a70` — the TAE child group name, padded to at least two digits. */
    taeGroup: string;
    /** `5000070` — the TAE child's BND4 entry id. */
    taeEntryId: number;
}
/** Family-level identity: `70 -> {family: 70, taeGroup: 'a70', taeEntryId: 5000070}`. */
export declare function describeAnimFamily(family: number): AnimFamilyIdentity | null;
export interface AnimIdentity extends AnimFamilyIdentity {
    animId: number;
    /** `1070410000` — the animation's BND4 entry id inside the anibnd. */
    animationEntryId: number;
    /** `a070_410000.hkt` — the native animation file the TAE child references. */
    hkxName: string;
}
/** Full animation identity: the four numbers/names a caller would otherwise compute by hand. */
export declare function describeAnimation(family: number, animId: number): AnimIdentity | null;
/** Which part of a TAE child record the family was read from. */
export type AnimFamilySource = 'entry-id' | 'tae-group' | 'entry-name';
export interface TaeEntryFamily {
    family: number;
    taeGroup: string;
    taeEntryId: number;
    /** Every source that resolved, in the order they were consulted. */
    sources: AnimFamilySource[];
    /** True when every source that resolved named the same family. */
    agrees: boolean;
    /** Set when the sources disagree: the record's own id and its name describe different families. */
    conflict?: string;
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
export declare function familyOfTaeEntry(entry: {
    entryId?: number | undefined;
    taeGroup?: string | undefined;
    entryName?: string | undefined;
    taeEntryName?: string | undefined;
}): TaeEntryFamily | null;
