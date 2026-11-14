/**
 * Sekiro ESD（Event State Definition，.esd）只读模型文档 wire 类型与三页投影。
 *
 * 与 Bridge 的 read-esd-document 一一对应（BEHAVIOR-55A）。
 * 布局权威在 C# 侧 EsdNativeDocument.cs；这里的类型只描述 wire 形状，
 * 不维护第二套 native parser。
 *
 * 语义：unknown layout 由 authority 表达——RPN 字节码不解码登记在 unparsedGaps、
 * 声明量与实解析量不符登记在 coverageShortfalls，任一非空都会把 authority
 * 压到 partial，上层不得把「读出来了」伪装成「完整解析」。跳转图闭合性由
 * transitionGraph.closed 单独表达（悬空/指向哨兵目标会破坏状态机可达性）。
 * `projectEsdDocumentPages` 是纯函数，消费方用它把单个 envelope 投影成
 * states / conditions / transitions 三页，不做任何 I/O。
 */
/** 把 read-esd-document envelope 投影成三页。纯函数，不吞异常、不做 I/O。 */
export function projectEsdDocumentPages(doc) {
    return {
        states: {
            stateGroupCount: doc.stateGroupCount,
            stateCount: doc.stateCount,
            stateRecordCount: doc.parsedStateRecordCount,
            stateSentinelModelConsistent: doc.stateSentinelModelConsistent,
            stateSentinelDivergentGroupIds: doc.stateSentinelDivergentGroupIds,
            stateGroups: doc.stateGroups,
            stateGroupsTruncated: doc.stateGroupsTruncated,
        },
        conditions: {
            declaredConditionCount: doc.declaredConditionCount,
            parsedConditionCount: doc.parsedConditionCount,
            samples: doc.conditionSamples,
            samplesTruncated: doc.conditionSamplesTruncated,
        },
        transitions: {
            edgeCount: doc.transitionGraph.edgeCount,
            resolved: doc.transitionGraph.resolved,
            none: doc.transitionGraph.none,
            sentinel: doc.transitionGraph.sentinel,
            dangling: doc.transitionGraph.dangling,
            closed: doc.transitionGraph.closed,
            edges: doc.transitionGraph.edges,
            edgesTruncated: doc.transitionGraph.edgesTruncated,
            danglingSamples: doc.transitionGraph.danglingSamples,
            sentinelSamples: doc.transitionGraph.sentinelSamples,
        },
    };
}
/** 窄守卫：判读一个 read-esd-document 响应是不是 EsdDocument。 */
export function isEsdDocument(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const v = value;
    return v.format === 'ESD'
        && typeof v.sourceHash === 'string'
        && typeof v.authority === 'string'
        && typeof v.transitionGraph === 'object' && v.transitionGraph !== null
        && typeof v.commandCalls === 'object' && v.commandCalls !== null;
}
//# sourceMappingURL=behavior-editor.js.map