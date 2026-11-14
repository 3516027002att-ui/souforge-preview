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
/** 一个本作真实存在的 PARAM 表：native 类型名 + 承载它的物理子文件（basename，无扩展名）。 */
export interface GameParamTable {
    /** PARAM header 里的 native 类型名，也是 Bridge/元数据认的表名。 */
    typeName: string;
    /** 物理子文件 basename（不含 `.param`）；同一类型可以有多个。 */
    children: readonly string[];
}
export declare const SEKIRO_GAME_PARAM_TABLES: readonly GameParamTable[];
/**
 * 表名折叠：去掉路径与 `.param` 扩展名 → 小写 → 只留字母数字 → 去掉 `_ST` 类型后缀。
 *
 * 于是 `SP_EFFECT_PARAM_ST`、`SpEffectParam`、`param\GameParam\SpEffectParam.param`
 * 得到同一个键。这是 table 过滤、目录键、以及 `findTableEntries` 的 family 解析
 * 共用的唯一规则（后者见 `paramTableAliasKey`）。
 */
export declare function tableKey(value: string): string;
/** `spelling` 是否指向本作真实存在的表；返回值是它的 native 类型名。 */
export declare function resolveGameParamTable(spelling: string): string | undefined;
/** 本作 gameparam 里是否存在这个 native 类型（表）。 */
export declare function isGameParamTable(typeName: string): boolean;
