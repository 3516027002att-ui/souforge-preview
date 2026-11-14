/**
 * PARAM → PARAM 的条件引用 provider（T04）。
 *
 * 与 `paramTextReferences.ts`（PARAM→FMG 文本连接）互补：这里处理受信任
 * metadata 的 `Refs=` 规则把一个整数字段指向另一张参数表某一行的情况。
 *
 * 硬性约束（执行指令 §T04）：
 * - 只有 `refsProvenance === 'trusted-metadata'` 的字段才可能生成 confirmed 边；
 *   fieldId 包含 "Param"、描述包含 "特效"、或数值恰好相同，都不构成引用。
 * - 条件引用必须读取同一行的兄弟字段后三态判定：成立 → 候选目标；不成立 →
 *   规则不适用（计入 stats，不产生诊断噪声）；兄弟字段缺失/未解码 →
 *   unresolved-condition 诊断。三者不得都落入空数组。
 * - `refsRejected` 片段进入诊断，影响该规则的覆盖完整性，不得静默丢弃。
 * - 目标表名按容器 entry 名做大小写不敏感唯一匹配；多个物理 entry 命中同一
 *   名字时返回候选诊断，不选第一项。
 * - 悬空引用（目标行不存在）不能消失：进入 PARAM_REF_TARGET_MISSING 诊断，
 *   但绝不生成指向不存在目标的 confirmed 边。
 * - 重复 rowId 的物理行生成可区分候选身份（rowIndex/dataHash），不覆盖。
 */
import type { Diagnostic, ParamExport, ReferenceEdge } from '@soulforge/shared';
export interface ParamRefStats {
    confirmed: number;
    /** 条件不成立 → 规则对该行不适用（正常结果，不是缺口）。 */
    notApplicable: number;
    /** 条件字段缺失或无法解码为整数。 */
    unresolvedConditions: number;
    /** 未识别的 Refs 片段数量（语义缺口）。 */
    rejectedFragments: number;
    /** 目标表在索引中不存在。 */
    missingTables: number;
    /** 目标行不存在（悬空引用）。 */
    danglingTargets: number;
    /** 目标表或目标行有多个候选。 */
    ambiguousTargets: number;
}
export interface ParamReferenceBuildResult {
    edges: ReferenceEdge[];
    diagnostics: Diagnostic[];
    stats: ParamRefStats;
}
export declare function buildParamReferenceEdges(params: readonly ParamExport[]): ParamReferenceBuildResult;
