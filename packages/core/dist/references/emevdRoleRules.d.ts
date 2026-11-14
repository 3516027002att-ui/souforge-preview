/**
 * 显式 EMEVD 参数角色规则表（执行指令 §T05 步骤 2/5）。
 *
 * 规则项包含：游戏、registry 来源、指令定义（名称＋参数位置＋参数名）、
 * 引用命名空间。这里的每一条都必须能追溯到仓库受支持定义或测试夹具：
 *
 * - `InitializeEvent` 的 eventId 位于第 2 参（位置 1），而一手 Sekiro
 *   Schema 中的 `InitializeCommonEvent` 的 eventId 位于第 1 参（位置 0），
 *   后续参数是 vararg。不能把两者按同一个调用签名处理。
 * - 命名空间：同文件事件优先；`common.emevd` / `commonfunc.emevd` 是
 *   Sekiro 的全局事件命名空间（真实语料入口，见 `emevd/stableIdentity.ts`
 *   与 full-document 注释中的 common.emevd 规模说明）。
 *
 * 禁止事项（§T05 步骤 2）：不得用指令名或参数名子串作确定性规则。名称
 * 子串推断只存在于 provider 的 hypothesis 通道，且永不产出 confirmed 边。
 */
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
export type EmevdReferenceNamespace = 'event' | 'event-common' | 'flag' | 'param' | 'map-entity' | 'map-region' | 'text';
export interface EmevdRoleRule {
    /** Rule identity, surfaced in edge reasons and evidence. */
    readonly ruleId: string;
    readonly game: 'sekiro';
    /**
     * Registry origins this rule may fire against. `'imported'`/`'user-derived'`
     * are trusted production registries; `'fixture'` is only for synthetic
     * smokes. A rule never fires when the registry origin is absent.
     */
    readonly registryOrigins: readonly EmedfRegistry['origin'][];
    /** Exact EMEDF instruction name (case-sensitive, as defined in the registry). */
    readonly instructionName: string;
    /** Zero-based native argument position. */
    readonly argPosition: number;
    /** Exact EMEDF arg definition name at that position. */
    readonly argName: string;
    readonly namespace: EmevdReferenceNamespace;
    /** Optional target PARAM table when the namespace is `param`. */
    readonly targetParamName?: string;
    /** Where the rule came from — repo-supported definition citation. */
    readonly source: string;
}
export declare const EMEVD_ROLE_RULES: readonly EmevdRoleRule[];
/**
 * Match a registry instruction definition against the explicit rule table.
 * Requires the exact instruction name AND the exact arg name at the exact
 * position — never a substring. Returns undefined when the registry has no
 * def or no rule applies.
 */
export declare function matchEmevdRoleRule(registry: EmedfRegistry, bank: number, id: number, argPosition: number): EmevdRoleRule | undefined;
/** True when the source URI names the global common/commonfunc EMEVD namespace. */
export declare function isCommonEmevdNamespace(sourceUri: string): boolean;
