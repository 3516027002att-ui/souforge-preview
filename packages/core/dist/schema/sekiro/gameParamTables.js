/**
 * 本作实际存在的 PARAM 表清单（Sekiro 1.6）。
 *
 * ── 为什么需要这份清单 ──
 *
 * 随包 paramdef（`firstPartySchemaData`）是**类型字典**，不是**表清单**：它声明 160 个
 * native 类型，但 `param/gameparam/gameparam.parambnd.dcx` 只有 138 个子文件 / 122 个
 * native 类型。多出来的 38 个类型（AI_ATTACK_PARAM_ST、MISSILE_PARAM_ST、YEBIS_BANK、
 * FOG_BANK、CS_*_QUALITY_DETAIL …）在这部作品的容器里根本没有对应子文件——写它们只会
 * 得到「表不存在」，读它们连字节都没有。凡是要回答「有没有这张表/这个字段」的地方，
 * 都必须以本清单为准，不能拿 paramdef 类型字典当表清单。
 *
 * ── 清单从哪里来 ──
 *
 * 每个子文件的 PARAM header 在 offset 0x10 存着类型名偏移（i64），偏移处是 ASCIIZ 的
 * native 类型名。清单就是逐个读这 138 个子文件得到的 `(typeName, 物理子文件名)` 对，
 * 不按文件名猜：`ThrowParam.param` 的 header 是 `THROW_INFO_BANK`，
 * `CalcCorrectGraph.param` 的 header 是 `CACL_CORRECT_GRAPH_ST`（paramdef 原拼写），
 * `HPEstusFlaskRecoveryParam.param` 与 `MPEstusFlaskRecoveryParam.param` 都是
 * `ESTUS_FLASK_RECOVERY_PARAM_ST`。也正因为如此，一个类型可能对应多个子文件
 * （ATK_PARAM_ST → AtkParam_Npc / AtkParam_Pc），判定「存在」只能按类型名，不能按文件名。
 *
 * 这里只有**名字**，没有字节、没有行值、没有偏移；它是游戏文件的目录，不是游戏数据。
 * 3 个子文件的 header 类型名为空（MenuColorTableParam、default_AIStandardInfoBank、
 * default_EnemyBehaviorBank，均为未被类型化读取的旧/内嵌表），因此不在清单里。
 *
 * ── 维护规则 ──
 *
 * 清单只允许由「本作 gameparam 的真实 header」更新，不允许为了多搜到几个字段而加条目：
 * 加进来的每一条都必须有一个真实子文件能打开。`gameParamTables.test.ts` 钉住
 * 「清单 ⊆ 随包 paramdef」「清单里的每个类型都能按类型名或物理名解析回来」。
 */
export const SEKIRO_GAME_PARAM_TABLES = Object.freeze([
    { typeName: 'ACTIONBUTTON_PARAM_ST', children: ['ActionButtonParam'] },
    { typeName: 'ACTION_GUIDE_PARAM_ST', children: ['ActionGuideParam'] },
    { typeName: 'ACTION_UNLOCK_PARAM_ST', children: ['ActionUnlockParam'] },
    { typeName: 'AI_SOUND_PARAM_ST', children: ['AiSoundParam'] },
    { typeName: 'ATK_PARAM_ST', children: ['AtkParam_Npc', 'AtkParam_Pc'] },
    { typeName: 'ATTACK_ELEMENT_CORRECT_PARAM_ST', children: ['AttackElementCorrectParam'] },
    { typeName: 'BEHAVIOR_PARAM_ST', children: ['BehaviorParam', 'BehaviorParam_PC'] },
    { typeName: 'BONFIRE_WARP_PARAM_ST', children: ['BonfireWarpParam'] },
    { typeName: 'BUDGET_PARAM_ST', children: ['BudgetParam'] },
    { typeName: 'BULLET_CREATE_LIMIT_PARAM_ST', children: ['BulletCreateLimitParam'] },
    { typeName: 'BULLET_PARAM_ST', children: ['Bullet'] },
    { typeName: 'CACL_CORRECT_GRAPH_ST', children: ['CalcCorrectGraph'] },
    { typeName: 'CAMERA_PARAM_ST', children: ['CameraParam'] },
    { typeName: 'CAMERA_SET_PARAM_ST', children: ['CameraSetParam'] },
    { typeName: 'CEREMONY_PARAM_ST', children: ['Ceremony'] },
    { typeName: 'CHARACTER_INIT_PARAM', children: ['CharaInitParam'] },
    { typeName: 'CHARMAKEMENUTOP_PARAM_ST', children: ['CharMakeMenuTopParam'] },
    { typeName: 'CHARMAKEMENU_LISTITEM_PARAM_ST', children: ['CharMakeMenuListItemParam'] },
    { typeName: 'CHR_PHYSICS_HOMING_ST', children: ['ChrPhysicsHomingParam'] },
    { typeName: 'CHR_PHYSICS_VELOCITY_CHANGE_ST', children: ['ChrPhysicsVelocityChangeParam'] },
    { typeName: 'CLEAR_COUNT_CORRECT_PARAM_ST', children: ['ClearCountCorrectParam'] },
    { typeName: 'COOL_TIME_PARAM_ST', children: ['CoolTimeParam'] },
    { typeName: 'CS_HIT_MATERIAL_SPECIAL_SETTING_PARAM_ST', children: ['HitMaterialSpecialSettingParam'] },
    { typeName: 'CULT_SETTING_PARAM_ST', children: ['CultSettingParam'] },
    { typeName: 'CUTSCENE_PARAM_ST', children: ['CutsceneParam'] },
    { typeName: 'DECAL_PARAM_ST', children: ['DecalParam'] },
    { typeName: 'DEFAULT_KEY_ASSIGN_PARAM_ST', children: ['DefaultKeyAssignParam00', 'DefaultKeyAssignParam01', 'DefaultKeyAssignParam02', 'DefaultKeyAssignParam03', 'DefaultKeyAssignParam04'] },
    { typeName: 'DIRECTION_CAMERA_PARAM_ST', children: ['DirectionCameraParam'] },
    { typeName: 'DYING_EFFECT_PARAM_ST', children: ['DyingEffectParam'] },
    { typeName: 'ENEMY_COMMOM_PARAM_ST', children: ['EnemyCommonParam'] },
    { typeName: 'EQUIP_MTRL_SET_PARAM_ST', children: ['EquipMtrlSetParam'] },
    { typeName: 'EQUIP_PARAM_ACCESSORY_ST', children: ['EquipParamAccessory'] },
    { typeName: 'EQUIP_PARAM_GOODS_ST', children: ['EquipParamGoods'] },
    { typeName: 'EQUIP_PARAM_PROTECTOR_ST', children: ['EquipParamProtector'] },
    { typeName: 'EQUIP_PARAM_WEAPON_ST', children: ['EquipParamWeapon'] },
    { typeName: 'ESTUS_FLASK_RECOVERY_PARAM_ST', children: ['HPEstusFlaskRecoveryParam', 'MPEstusFlaskRecoveryParam'] },
    { typeName: 'FACE_GEN_PARAM_ST', children: ['FaceGenParam'] },
    { typeName: 'FACE_PARAM_ST', children: ['FaceParam'] },
    { typeName: 'FACE_RANGE_PARAM_ST', children: ['FaceRangeParam'] },
    { typeName: 'FOOT_SFX_PARAM_ST', children: ['FootSfxParam'] },
    { typeName: 'GAME_AREA_PARAM_ST', children: ['GameAreaParam'] },
    { typeName: 'GAME_PROGRESS_PARAM_ST', children: ['GameProgressParam'] },
    { typeName: 'GAME_SYSTEM_PARAM_ST', children: ['GameSystemParam'] },
    { typeName: 'GEMEFFECT_PARAM_ST', children: ['GemeffectParam'] },
    { typeName: 'GEM_CATEGORY_PARAM_ST', children: ['GemCategoryParam'] },
    { typeName: 'GEM_DROP_DOPING_PARAM_ST', children: ['GemDropDopingParam'] },
    { typeName: 'GEM_DROP_MODIFY_PARAM_ST', children: ['GemDropModifyParam'] },
    { typeName: 'GEM_GEN_PARAM_ST', children: ['GemGenParam'] },
    { typeName: 'GRAPHICS_PARAM_ST', children: ['GraphicsParam'] },
    { typeName: 'GRASS_LOD_RANGE_PARAM_ST', children: ['GrassLodRangeParam'] },
    { typeName: 'GRASS_TYPE_PARAM_ST', children: ['GrassTypeParam'] },
    { typeName: 'HIT_EFFECT_SE_PARAM_ST', children: ['HitEffectSeHitWallParam', 'HitEffectSeJustGuardParam', 'HitEffectSeParam'] },
    { typeName: 'HIT_EFFECT_SFX_ANGLE_PARAM_ST', children: ['HitEffectSfxAngleParam'] },
    { typeName: 'HIT_EFFECT_SFX_CONCEPT_PARAM_ST', children: ['HitEffectSfxConceptJustGuardParam', 'HitEffectSfxConceptParam'] },
    { typeName: 'HIT_EFFECT_SFX_PARAM_ST', children: ['HitEffectSfxParam'] },
    { typeName: 'HIT_MTRL_PARAM_ST', children: ['HitMtrlParam'] },
    { typeName: 'ITEMLOT_PARAM_ST', children: ['ItemLotParam'] },
    { typeName: 'KNOCKBACK_PARAM_ST', children: ['KnockBackParam'] },
    { typeName: 'KNOWLEDGE_LOADSCREEN_ITEM_PARAM_ST', children: ['KnowledgeLoadScreenItemParam'] },
    { typeName: 'LOAD_BALANCER_DRAW_DIST_SCALE_PARAM_ST', children: ['LoadBalancerDrawDistScaleParam'] },
    { typeName: 'LOAD_BALANCER_PARAM_ST', children: ['LoadBalancerParam'] },
    { typeName: 'LOCK_CAM_PARAM_ST', children: ['LockCamParam'] },
    { typeName: 'LOD_BANK_ST', children: ['LodParam', 'LodParam_ps4', 'LodParam_xb1'] },
    { typeName: 'LOD_PLATFORM_ST', children: ['LodPlatform'] },
    { typeName: 'MAGIC_PARAM_ST', children: ['Magic'] },
    { typeName: 'MAP_MIMICRY_ESTABLISHMENT_PARAM_ST', children: ['MapMimicryEstablishmentParam'] },
    { typeName: 'MAP_PARTS_PARAM_ST', children: ['MapPartsParam'] },
    { typeName: 'MATERIAL_EX_PARAM_ST', children: ['MaterialExParam'] },
    { typeName: 'MENUPROPERTY_LAYOUT', children: ['MenuPropertyLayoutParam'] },
    { typeName: 'MENUPROPERTY_SPEC', children: ['MenuPropertySpecParam'] },
    { typeName: 'MENU_OFFSCR_REND_PARAM_ST', children: ['MenuOffscrRendParam'] },
    { typeName: 'MENU_PARAM_COLOR_TABLE_ST', children: ['NewMenuColorTableParam'] },
    { typeName: 'MENU_PARAM_ST', children: ['MenuParam'] },
    { typeName: 'MENU_TUTORIAL_PARAM_ST', children: ['MenuTutorialParam'] },
    { typeName: 'MENU_VALUE_TABLE_SPEC', children: ['MenuValueTableParam'] },
    { typeName: 'MODEL_SFX_PARAM_ST', children: ['ModelSfxParam'] },
    { typeName: 'MOVE_PARAM_ST', children: ['MoveParam'] },
    { typeName: 'MULTI_ESTUS_FLASK_BONUS_PARAM_ST', children: ['MultiHPEstusFlaskBonusParam', 'MultiMPEstusFlaskBonusParam'] },
    { typeName: 'MULTI_PLAY_CORRECTION_PARAM_ST', children: ['MultiPlayCorrectionParam'] },
    { typeName: 'MULTI_SOUL_BONUS_RATE_PARAM_ST', children: ['MultiSoulBonusRateParam'] },
    { typeName: 'NETWORK_AREA_PARAM_ST', children: ['NetworkAreaParam'] },
    { typeName: 'NETWORK_MSG_PARAM_ST', children: ['NetworkMsgParam'] },
    { typeName: 'NETWORK_PARAM_ST', children: ['NetworkParam'] },
    { typeName: 'NPC_AI_ACTION_PARAM_ST', children: ['NpcAiActionParam'] },
    { typeName: 'NPC_PARAM_ST', children: ['NpcParam'] },
    { typeName: 'NPC_THINK_PARAM_ST', children: ['NpcThinkParam'] },
    { typeName: 'OBJECT_MATERIAL_SFX_PARAM_ST', children: ['ObjectMaterialSfxParam'] },
    { typeName: 'OBJECT_PARAM_ST', children: ['ObjectParam'] },
    { typeName: 'OBJ_ACT_PARAM_ST', children: ['ObjActParam'] },
    { typeName: 'PHANTOM_PARAM_ST', children: ['PhantomParam'] },
    { typeName: 'PLAY_REGION_PARAM_ST', children: ['PlayRegionParam'] },
    { typeName: 'PROTECTOR_GEN_PARAM_ST', children: ['ProtectorGenParam'] },
    { typeName: 'RAGDOLL_PARAM_ST', children: ['RagdollParam'] },
    { typeName: 'REINFORCE_PARAM_PROTECTOR_ST', children: ['ReinforceParamProtector'] },
    { typeName: 'REINFORCE_PARAM_WEAPON_ST', children: ['ReinforceParamWeapon'] },
    { typeName: 'REMATCH_WARP_PARAM_ST', children: ['RematchWarpParam'] },
    { typeName: 'RESOURCEITEMLOT_PARAM_ST', children: ['ResourceItemLotParam'] },
    { typeName: 'RESOURCEITEM_PARAM_ST', children: ['ResourceItemParam'] },
    { typeName: 'ROLE_PARAM_ST', children: ['RoleParam'] },
    { typeName: 'SHOP_LINEUP_PARAM', children: ['ShopLineupParam'] },
    { typeName: 'SKELETON_PARAM_ST', children: ['SkeletonParam'] },
    { typeName: 'SKILL_PARAM_ST', children: ['SkillParam'] },
    { typeName: 'SP_EFFECT_PARAM_ST', children: ['SpEffectParam'] },
    { typeName: 'SP_EFFECT_VFX_PARAM_ST', children: ['SpEffectVfxParam'] },
    { typeName: 'STAMINA_CONTROL_PARAM_ST', children: ['StaminaControlParam'] },
    { typeName: 'SWORD_ARTS_PARAM_ST', children: ['SwordArtsParam'] },
    { typeName: 'TALK_PARAM_ST', children: ['TalkParam'] },
    { typeName: 'TENTATIVE_PLAYER_PARAM_ST', children: ['TentativePlayerParam'] },
    { typeName: 'THROW_DIRECTION_DECAL_PARAM_ST', children: ['ThrowDirectionDecalParam'] },
    { typeName: 'THROW_DIRECTION_SE_PARAM_ST', children: ['ThrowDirectionSeParam'] },
    { typeName: 'THROW_DIRECTION_SFX_PARAM_ST', children: ['ThrowDirectionSfxParam'] },
    { typeName: 'THROW_INFO_BANK', children: ['ThrowParam'] },
    { typeName: 'THROW_KIND_PARAM_ST', children: ['ThrowKindParam'] },
    { typeName: 'TOUGHNESS_PARAM_ST', children: ['ToughnessParam'] },
    { typeName: 'UPPER_ARM_PARAM_ST', children: ['UpperArmParam'] },
    { typeName: 'WEAPON_GEN_PARAM_ST', children: ['WeaponGenParam'] },
    { typeName: 'WEP_ABSORP_POS_PARAM_ST', children: ['WepAbsorpPosParam'] },
    { typeName: 'WET_ASPECT_PARAM_ST', children: ['WetAspectParam'] },
    { typeName: 'WHITE_SIGN_COOL_TIME_PARAM_ST', children: ['WhiteSignCoolTimeParam'] },
    { typeName: 'WIRE_POINT_SEARCH_PARAM_ST', children: ['WirePointSearchParam'] },
    { typeName: 'WIRE_SET_PARAM_ST', children: ['WireSetParam'] },
    { typeName: 'WIRE_VARIATION_ST', children: ['WireVariationParam'] }
]);
/**
 * 表名折叠：去掉路径与 `.param` 扩展名 → 小写 → 只留字母数字 → 去掉 `_ST` 类型后缀。
 *
 * 于是 `SP_EFFECT_PARAM_ST`、`SpEffectParam`、`param\GameParam\SpEffectParam.param`
 * 得到同一个键。这是 table 过滤、目录键、以及 `findTableEntries` 的 family 解析
 * 共用的唯一规则（后者见 `paramTableAliasKey`）。
 */
export function tableKey(value) {
    const base = value.replace(/\\/gu, '/').split('/').pop() ?? value;
    const compact = base.replace(/\.param$/iu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '');
    return compact.endsWith('st') && compact.length > 2 ? compact.slice(0, -2) : compact;
}
const byTypeName = new Map();
const byChildName = new Map();
for (const table of SEKIRO_GAME_PARAM_TABLES) {
    byTypeName.set(tableKey(table.typeName), table);
    for (const child of table.children) {
        // 物理名单独索引：`ThrowParam` / `CalcCorrectGraph` 这类子文件名与 native 类型名
        // 拼写完全不同，只按类型名折叠是查不到的。
        if (!byChildName.has(tableKey(child)))
            byChildName.set(tableKey(child), table);
    }
}
/** `spelling` 是否指向本作真实存在的表；返回值是它的 native 类型名。 */
export function resolveGameParamTable(spelling) {
    const key = tableKey(spelling);
    if (key.length === 0)
        return undefined;
    return byTypeName.get(key)?.typeName ?? byChildName.get(key)?.typeName;
}
/** 本作 gameparam 里是否存在这个 native 类型（表）。 */
export function isGameParamTable(typeName) {
    return byTypeName.has(tableKey(typeName));
}
//# sourceMappingURL=gameParamTables.js.map