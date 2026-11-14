/**
 * PARAM 元数据信任策略的持久化(app.db 的 app_settings 表)。
 *
 * ── 为什么需要它 ──
 *
 * `matchParamMetadataPackage` 要求显式用户信任策略,缺失时报
 * `PARAM_METADATA_TRUST_POLICY_REQUIRED` 并拒绝匹配。此前生产侧没有任何信任策略
 * 的构造代码(只有测试里有),于是 PARAM 字段定义要么拿不到,要么只能靠直连
 * `definitions.find(...)` 绕过包校验、描述符匹配与信任策略三层检查。
 *
 * 绕过是不可接受的:那三层守的是「两台机器拿到同名但内容不同的元数据包」。
 * 所以这里补上缺的那一环 —— 用户确认一次,策略存进 app.db,之后走正规路径。
 *
 * ── 信任绑定到摘要,不绑定到名字 ──
 *
 * 存的每一条都含 packageDigest / sourceContentDigest / licenseTextDigest。
 * 包内容变了(升级、被替换、被篡改)摘要就变,已存的信任条目不再匹配,
 * 匹配器报 `PARAM_METADATA_TRUST_ENTRY_DIGEST_INVALID` 而不是静默放行 ——
 * 实测确认过这个行为。也就是说「确认过一次」不等于「以后什么都信」。
 *
 * ── 为什么不由应用预置 ──
 *
 * 应用自带一份信任策略在技术上更省事,但那是把用户的决定替换成开发者的。
 * 钉死策略(SMITHBOX_SDT_2_2_4_POLICY)校验的是「这个文件是不是那个发布」,
 * 信任策略回答的是「你愿不愿意用它」—— 两个问题不同,后者只能由用户回答。
 */
import type { ParamMetadataPackage, ParamMetadataTrustPolicy } from '@soulforge/shared';
/** 设置键。改它会让既有确认失效,等同要求用户重新确认。 */
export declare const PARAM_METADATA_TRUST_SETTING_KEY = "param.metadata.trustPolicy.v1";
/**
 * 键值读写抽象,不依赖具体存储实现。
 *
 * 刻意只要求这三个同步方法:app.db 的 app_settings 可以实现它,
 * userData 下的独立 JSON 文件也可以。桌面端实际用后者 —— 信任决定是一条
 * 单值用户设置,不需要事务,也不该把「能不能打开 PARAM 字段视图」耦合到
 * 数据库工具子进程的可用性上。
 */
export interface AppSettingsStore {
    get(key: string): string | undefined;
    set(key: string, valueJson: string, updatedAt: string): void;
    delete(key: string): void;
}
export interface ParamMetadataTrustDecision {
    /** 用户确认的包身份与摘要快照。 */
    policy: ParamMetadataTrustPolicy;
    /** 确认时间(ISO)。 */
    confirmedAt: string;
}
/**
 * 从一个**已通过来源校验**的包构造信任策略条目。
 *
 * 输入必须是 importPinnedSmithboxSdtParamMetadata 等导入器的产物 —— 那一步
 * 已经核对过归档摘要、源树摘要与许可证摘要。本函数只是把那些事实抄成
 * 匹配器要的形状,不做任何降级或补全:缺字段就返回失败,而不是填个空串
 * 让匹配器以为一切正常。
 */
export declare function buildTrustPolicyFromPackage(metadataPackage: ParamMetadataPackage, policyId: string): {
    ok: true;
    policy: ParamMetadataTrustPolicy;
} | {
    ok: false;
    code: string;
    message: string;
};
/**
 * 读出已保存的信任决定。
 *
 * 解析失败返回 null 而不抛:一条坏掉的设置行不该让 PARAM 完全打不开。
 * 但也不做修补 —— 返回 null 的效果是「未确认」,用户会被再问一次,
 * 那比猜测一个残缺策略的含义安全。
 */
export declare function readTrustDecision(store: AppSettingsStore): ParamMetadataTrustDecision | null;
export declare function writeTrustDecision(store: AppSettingsStore, decision: ParamMetadataTrustDecision): void;
export declare function clearTrustDecision(store: AppSettingsStore): void;
/**
 * 已保存的信任是否覆盖当前这个包。
 *
 * 逐项比对身份与三个摘要。任一不符即视为未覆盖 —— 那时应重新询问用户,
 * 而不是「名字对得上就放行」。包升级会走到这条路径:2.2.4 的确认不自动
 * 延伸到 2.3.0,因为那是另一份内容。
 */
export declare function trustCoversPackage(decision: ParamMetadataTrustDecision | null, metadataPackage: ParamMetadataPackage): boolean;
