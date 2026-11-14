/**
 * EquipParamWeapon → TAE motion group: which PARAM fields name a weapon's action groups.
 *
 * Why this module exists as its own file: the rule that produced it. Two tools need the same
 * rule — `search_tae_events` (weaponId → action-group filter) and `explain_skill_actions`
 * (SkillParam.virtualWeaponId → EquipParamWeapon → candidate actions). Round 54 kept the rule
 * inside `search_tae_events.ts` and exported it for reuse, which made that module export two
 * functions; the `agent-tool-modules` fixture reads that directory and requires each file to be
 * exactly one tool declaration, because a tool module's exports are its boundary.
 *
 * The rule is a PARAM-table fact (which column of EquipParamWeapon selects which animation
 * group), not a TAE-search implementation detail, so it lives beside the other PARAM resolvers
 * (`dropChain.ts` is the same shape: a pure resolver that the tool wrappers compose). Being
 * pure — no Bridge read, no file access, no imports — it is also outside the `ai/tools`
 * directory that the fixture enumerates, so reuse no longer collides with the rule.
 */
/** The EquipParamWeapon fields that can name a TAE motion group.
 *
 *  `search_param_fields {table:"EquipParamWeapon", query:"motion"}` returns exactly
 *  wepmotionCategory, wepmotionOneHandId, wepmotionBothHandId and guardmotionCategory;
 *  Sekiro's schema has no wepmotionLeftHandId. `spAtkcategory` does not carry "motion" in
 *  its field id, but its native description says "Overwrites default wepMotionCategory
 *  animations with ones in this TAE group", so it is an override rule and is resolved too.
 *  guardmotionCategory only selects guard animations, not the weapon's attack move set, so
 *  it is listed by the inventory but never used as an action group.
 *
 *  A stance field value of 0 means "not set" (it is the value on every weapon that has no
 *  stance override, and treating it as a00 would attach the whole 939-animation generic
 *  group to almost every weapon). wepmotionCategory is the base field, so it is mapped
 *  literally, including 0 -> a00. */
export type WeaponMotionField = 'wepmotionCategory' | 'wepmotionOneHandId' | 'wepmotionBothHandId' | 'spAtkcategory';
export interface WeaponMotionFieldValue {
    field: WeaponMotionField;
    value: number | null;
    role: 'base-category' | 'one-handed' | 'both-handed' | 'special-attack-override';
    applied: boolean;
    taeGroup?: string;
    reason?: string;
}
export declare const WEAPON_MOTION_FIELDS: ReadonlyArray<{
    field: WeaponMotionField;
    role: WeaponMotionFieldValue['role'];
    zeroMeansUnset: boolean;
}>;
/** Resolve every candidate group a weapon's motion fields name, rather than assuming
 *  wepmotionCategory is the only rule. Callers get one entry per field so a category and a
 *  stance override that disagree are both visible (a50 from wepmotionCategory, a10 from
 *  wepmotionOneHandId for EquipParamWeapon#110000), and the group list is the union used to
 *  filter actions. */
export declare function resolveWeaponMotionCandidates(values: Partial<Record<WeaponMotionField, number | null>>): {
    fields: WeaponMotionFieldValue[];
    groups: string[];
    resolvedBy: WeaponMotionField[];
};
