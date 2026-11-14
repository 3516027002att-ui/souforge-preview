import type { ParameterizedEntityCoverage } from './parameterizedEntityCoverage.js';
export interface QueryScopeDomainCoverage {
    /** 来源域（resource kind 名：event / param / msg / map …）。 */
    domain: string;
    covered: number;
    expected: number;
    stale: number;
}
export interface QueryScopedNegativeConclusionInput {
    /** 能产生本次查询目标引用的来源域；其它域的缺口与本次查询无关。 */
    domains: readonly string[];
    /** 上述来源域的实际覆盖（来自 `workspaceIndex.getCoverageSnapshot()`）。 */
    coverage: readonly QueryScopeDomainCoverage[];
    /** 本次查询通道的参数化实参评估；undefined 表示该通道没有查询级覆盖度来源。 */
    assessment?: ParameterizedEntityCoverage;
    /**
     * 该通道是否**必须**有参数化实参评估。公共事件形参只存在于事件指令通道；
     * 同域通道（例如 param→param 的受信任 metadata Refs）没有这套索引，把它当成
     * “通道不可用”会让有边的查询也返回 inconclusive。false 时否定结论只由来源域
     * 覆盖度决定。缺省为 true（原有行为）。
     */
    requiresParameterizedAssessment?: boolean;
    /** assessment 缺失时说明原因（必须写明，不能静默放行）。 */
    unavailableReason?: string;
    /** 人类可读的查询范围，例如 “m11_01_00_00 的事件文件”。 */
    scopeLabel: string;
}
export interface QueryScopedNegativeConclusion {
    verdict: 'negative-allowed' | 'inconclusive';
    negativeConclusionAllowed: boolean;
    blockedReasons: string[];
    caveats: string[];
    /** 本次查询范围内的逐来源域计数；供页面给出该域 totalSources。 */
    sources: QueryScopeDomainCoverage[];
}
export declare function buildQueryScopedNegativeConclusion(input: QueryScopedNegativeConclusionInput): QueryScopedNegativeConclusion;
