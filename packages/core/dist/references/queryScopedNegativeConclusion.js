const ROLE_LABEL = {
    entity: '实体实参（entityId / targetEntityId）',
    event: '事件调用实参（eventId）',
    text: '文本实参（messageId / nameId 等）'
};
const ROLE_TARGET = {
    entity: '实体',
    event: '事件',
    text: '文本条目'
};
const ROLE_CODE = {
    entity: 'ENTITY',
    event: 'EVENT',
    text: 'TEXT'
};
function listed(names) {
    return names.length <= 5
        ? names.join('、')
        : `${names.slice(0, 5).join('、')} 等 ${names.length} 类`;
}
function describeGap(entry) {
    if (entry.stale > 0)
        return `${entry.domain}(stale ${entry.stale})`;
    if (entry.expected <= 0)
        return `${entry.domain}(没有已索引来源)`;
    return `${entry.domain}(${entry.covered}/${entry.expected})`;
}
export function buildQueryScopedNegativeConclusion(input) {
    const blockedReasons = [];
    const caveats = [];
    const gaps = input.domains
        .map((domain) => input.coverage.find((entry) => entry.domain === domain))
        .filter((entry) => entry !== undefined)
        .filter((entry) => entry.stale > 0 || entry.expected <= 0 || entry.covered < entry.expected);
    const missing = input.domains.filter((domain) => !input.coverage.some((entry) => entry.domain === domain));
    if (gaps.length > 0 || missing.length > 0) {
        blockedReasons.push(`QUERY_SCOPE_INCOMPLETE:本次查询依赖的来源域没有读全（${[...gaps.map(describeGap), ...missing.map((domain) => `${domain}(无覆盖证书)`)].join('、')}）；`
            + '缺口本身就不允许否定结论。');
    }
    const assessment = input.assessment;
    if (input.requiresParameterizedAssessment === false) {
        // 同域通道没有公共事件形参这一层：既不能因此判“通道不可用”，也不能静默略过。
        caveats.push(`本次查询是同域通道（${input.domains.join('/')}），来源域内部没有公共事件形参；`
            + '否定结论只由这些来源域的覆盖度决定。');
    }
    else if (assessment === undefined) {
        blockedReasons.push(`QUERY_SCOPE_UNAVAILABLE:${input.unavailableReason?.trim() || '本次查询的引用通道没有查询级覆盖度来源'}；`
            + '无法证明“看不见的调用”不存在，否定结论不可用。');
    }
    else if (assessment.filesUnread > 0) {
        blockedReasons.push(`EVENT_INDEX_FILES_UNREAD:${input.scopeLabel}里有 ${assessment.filesUnread} 个事件文件没有读全；`
            + '未读出的指令可能正指向本次查询目标，否定结论不可用。');
    }
    else if (assessment.filesInScope === 0) {
        blockedReasons.push(`EVENT_INDEX_SCOPE_EMPTY:${input.scopeLabel}没有任何已索引的事件文件；`
            + '该范围的事件引用完全不可见，否定结论不可用。');
    }
    else if (assessment.blocksNegative) {
        const names = assessment.relevantInstructions.map((entry) => entry.name);
        blockedReasons.push(`EVENT_INDEX_PARAMETERIZED_${ROLE_CODE[assessment.role]}_ARGS:${input.scopeLabel}里有 ${assessment.relevantCount} 条指令的`
            + `${ROLE_LABEL[assessment.role]}来自公共事件形参（X<offset>_<width>）（${listed(names)}），无法归属到具体${ROLE_TARGET[assessment.role]}；`
            + `其中任意一条都可能正指向本次查询目标，因此“没有字面量命中”不能当作“不存在”。`);
        caveats.push(`参数化${ROLE_LABEL[assessment.role]}无法归属到具体${ROLE_TARGET[assessment.role]}，既不算证据也不算反证；本次否定结论已降级为 inconclusive。`);
    }
    else if (assessment.totalCount > 0 || assessment.otherRoleCount > 0) {
        const unrelated = assessment.unrelatedInstructions.map((entry) => entry.name);
        const parts = [];
        if (assessment.totalCount > 0) {
            parts.push(`${assessment.totalCount} 条参数化${ROLE_LABEL[assessment.role]}属于其它指令类`
                + `${unrelated.length > 0 ? `（${listed(unrelated)}）` : ''}`);
        }
        if (assessment.otherRoleCount > 0) {
            parts.push(`${assessment.otherRoleCount} 条参数化调用属于其它实参类（不是${ROLE_LABEL[assessment.role]}）`);
        }
        caveats.push(`本次查询范围内（${input.scopeLabel}）没有参数化${ROLE_LABEL[assessment.role]}；`
            + `${parts.join('，')}，与本次查询无关，因此否定结论仍成立（它们仍然既不算证据也不算反证）。`);
    }
    else {
        caveats.push(`本次查询范围内（${input.scopeLabel}）没有参数化调用，否定结论不受参数化实参影响。`);
    }
    const negativeConclusionAllowed = blockedReasons.length === 0;
    if (negativeConclusionAllowed) {
        caveats.push(`本次否定结论只覆盖 ${input.domains.join('/')} 这些来源域；其它域（地图、脚本、TAE 等）的缺口不参与本次判断。`);
    }
    return {
        verdict: negativeConclusionAllowed ? 'negative-allowed' : 'inconclusive',
        negativeConclusionAllowed,
        blockedReasons,
        caveats,
        sources: input.domains.map((domain) => input.coverage.find((entry) => entry.domain === domain)
            ?? { domain, covered: 0, expected: 0, stale: 0 })
    };
}
//# sourceMappingURL=queryScopedNegativeConclusion.js.map