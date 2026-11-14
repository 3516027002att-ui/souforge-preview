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
export const WEAPON_MOTION_FIELDS = [
    { field: 'wepmotionCategory', role: 'base-category', zeroMeansUnset: false },
    { field: 'wepmotionOneHandId', role: 'one-handed', zeroMeansUnset: true },
    { field: 'wepmotionBothHandId', role: 'both-handed', zeroMeansUnset: true },
    { field: 'spAtkcategory', role: 'special-attack-override', zeroMeansUnset: true }
];
const taeGroupOf = (value) => 'a' + String(value).padStart(2, '0');
/** Resolve every candidate group a weapon's motion fields name, rather than assuming
 *  wepmotionCategory is the only rule. Callers get one entry per field so a category and a
 *  stance override that disagree are both visible (a50 from wepmotionCategory, a10 from
 *  wepmotionOneHandId for EquipParamWeapon#110000), and the group list is the union used to
 *  filter actions. */
export function resolveWeaponMotionCandidates(values) {
    const fields = [];
    const groups = [];
    const resolvedBy = [];
    for (const spec of WEAPON_MOTION_FIELDS) {
        const raw = values[spec.field];
        if (raw === undefined) {
            fields.push({ field: spec.field, value: null, role: spec.role, applied: false, reason: '该表没有这个字段。' });
            continue;
        }
        if (raw === null || !Number.isSafeInteger(raw)) {
            fields.push({ field: spec.field, value: null, role: spec.role, applied: false, reason: '值不是整数。' });
            continue;
        }
        if (spec.field !== 'wepmotionCategory' && raw < 0) {
            fields.push({ field: spec.field, value: raw, role: spec.role, applied: false, reason: '负值表示未设置。' });
            continue;
        }
        if (spec.zeroMeansUnset && raw === 0) {
            fields.push({ field: spec.field, value: raw, role: spec.role, applied: false, reason: '0 表示该姿态覆盖未设置，不是 a00。' });
            continue;
        }
        const taeGroup = taeGroupOf(raw);
        fields.push({ field: spec.field, value: raw, role: spec.role, applied: true, taeGroup });
        if (!groups.includes(taeGroup))
            groups.push(taeGroup);
        resolvedBy.push(spec.field);
    }
    return { fields, groups, resolvedBy };
}
//# sourceMappingURL=weaponMotion.js.map