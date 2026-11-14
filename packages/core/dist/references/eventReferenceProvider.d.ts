/**
 * EMEVD 参数角色、事件调用与参数传递 provider（T05）。
 *
 * 与旧内联循环的三点区别（执行指令 §T05）：
 * 1. 只有显式携带的角色（Bridge/registry 摄取时写入 `arg.role`，且
 *    `roleSource` 不为纯名称推断）才生成 confirmed/high 边；`inferArgRole`
 *    的名称推断进入 hypothesis 通道（R07）：默认不出边，`includeHypotheses`
 *    时以 low + 规则名出现，绝不冒充 confirmed。
 * 2. 事件调用目标按命名空间解析：同一 EMEVD 文件内的同号事件才是确定目标；
 *    只有其他文件命中同号时不生成默认确定连接，返回候选诊断（I04）。
 * 3. 每条 confirmed 引用携带真实 typed 参数渲染的调用语句；registry 可用时
 *    未知 bank:id 保留诊断，扫描结束不宣称语义完整（R08）。
 *
 * 调用链遍历（有界：默认深度 ≤4、256 节点、512 扩展边）由
 * {@link buildEventCallChain} 提供，供 ReferenceQueryService（T08）组装
 * indirect 路径；图构建本身只发布直接边。
 */
import type { Diagnostic, EventExport, ReferenceEdge } from '@soulforge/shared';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
export interface EventReferenceBuildOptions {
    enableNumericFallback?: boolean;
    maxAmbiguousNumericMatches?: number;
    /** Hypothesis (name-inference) edges are excluded unless this is true. */
    includeHypotheses?: boolean;
    /** Trusted instruction registry; enables unknown-instruction diagnostics. */
    registry?: EmedfRegistry;
}
export interface EventReferenceBuildResult {
    edges: ReferenceEdge[];
    diagnostics: Diagnostic[];
    stats: {
        confirmed: number;
        hypothesisSuppressed: number;
        unknownInstructions: number;
        crossFileEventIdCandidates: number;
        suppressedAmbiguousNumbers: number;
    };
}
export interface EventReferenceTargetIndexes {
    mapEntitiesByEntityId: Map<number, Array<{
        uri: string;
        mapId?: string;
    }>>;
    paramRowsById: Map<number, {
        uri: string;
    }[]>;
    paramRowsByScopedId: Map<string, {
        uri: string;
    }[]>;
    textsById: Map<number, {
        uri: string;
    }[]>;
}
export declare const CALL_CHAIN_MAX_DEPTH = 4;
export declare const CALL_CHAIN_MAX_NODES = 256;
export declare const CALL_CHAIN_MAX_EXPANSION_EDGES = 512;
export declare function buildEventReferenceEdges(eventExports: readonly EventExport[], indexes: EventReferenceTargetIndexes, options?: EventReferenceBuildOptions): EventReferenceBuildResult;
export interface CallChainHop {
    fromEventUri: string;
    toEventUri: string;
    instructionUri: string;
    /** True when the target id came through a parameter binding (X<n>_<m>). */
    indirect: boolean;
    /** Parameter symbol the argument resolved through, when indirect. */
    parameterSymbol?: string;
    /** Byte offset in the parameter source block, parsed from X<offset>_<width>. */
    sourceStartByte?: number;
    /** Byte width of the bound slot; never dropped (T05 step 6). */
    byteCount?: number;
    /**
     * Native parameter record identity when the event's parameter table matched
     * this slot. Absent means the binding is unresolved — the hop stays visible
     * but is never presented as a complete proof (T05 step 7).
     */
    parameterInstructionIndex?: number;
    parameterTargetStartByte?: number;
}
export interface CallChainResult {
    rootUri: string;
    paths: CallChainHop[][];
    truncated: boolean;
    truncationReason?: string;
    cycles: string[];
}
/**
 * Bounded event-call chain from one root event. Depth counts edges (default
 * 3, max 4); node and expansion-edge budgets prevent blowup on dense graphs.
 * Reaching a limit returns the truncation explicitly — never a claim that the
 * traversal was complete (R11).
 */
export declare function buildEventCallChain(eventExports: readonly EventExport[], rootUri: string, options?: {
    maxDepth?: number;
    maxNodes?: number;
    maxExpansionEdges?: number;
    registry?: EmedfRegistry;
}): CallChainResult;
