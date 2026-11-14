/**
 * 脚本调用、容器身份与完整读取边界 provider（T06，执行指令 §T06）。
 *
 * 状态分离（§T06 步骤 1）：`ScriptSymbol.contentKind` 的
 * `catalog-only` / `bytecode` / `decompiled-view` / `source` 是四种不同事实。
 * 只有 `source`（loader profile 解码出的原文）产生 confirmed 调用证明；
 * 反编译视图只登记视图事实；字节码/目录条目保留编码诊断。绝不按角色号拼接
 * `cXXXX_ai.lua` 后声称该子项存在 —— 名称假设只在 `includeHypotheses` 下以
 * low + 规则名出现，且目标必须真实存在于目录。
 *
 * 容器身份（步骤 2）：`contains` 边只在 `catalogComplete` 为 true 时发布；
 * 目录页未读完时返回 SCRIPT_CATALOG_INCOMPLETE 诊断，任何子项存在性判断降为
 * unverified，不得声明覆盖完整。
 *
 * 调用解析（步骤 5-8）：调用节点全部来自受限 Lua 静态子集的词法/语法结果
 * （`luaStaticSubset.ts`），不使用全文件正则。注释、字符串、函数定义与局部
 * 遮蔽不会误报。参数只有字面量，或同一受限作用域内唯一且未被重新赋值的字面量
 * 绑定才可静态解析；其余标 dynamic，不执行脚本求值。
 *
 * API 语义规则表：仓库目前没有受信任的游戏脚本 API 参数语义登记，因此除
 * `require`（语言级模块加载，按同容器目录唯一匹配解析）外，其它调用只作为
 * 观察事实登记（resolution=unknown），不生成 confirmed 边。规则表留显式扩展点，
 * 新增规则必须携带出处。
 *
 * 读取边界（步骤 11）：本 provider 消费的是关联查询内已读取的脚本文本，输出
 * 的每条证据都是"片段观察事实"（bounded excerpt + span + sourceHash），不构成本
 * 脚本的完整读取/写入证明；full-script write proof 由 T09 的 NativeReadProofStore
 * 独立判定。
 */
import type { Diagnostic, ReferenceEdge, ScriptCallOccurrence, ScriptExport } from '@soulforge/shared';
export interface ScriptReferenceBuildOptions {
    /** Name-based asset/loader hypotheses (low, rule-named) are excluded unless true. */
    includeHypotheses?: boolean;
    /** Cap for bounded statement excerpts carried into evidence. */
    maxExcerptChars?: number;
    /**
     * Already located workspace objects that may be compared with literal
     * arguments in otherwise unknown calls.  These are observation edges only:
     * they never turn an unknown game API into a confirmed foreign key.
     */
    literalTargets?: ScriptLiteralTargetIndexes;
    /** Maximum literal matches emitted for one call site. */
    maxLiteralMatchesPerCall?: number;
}
export interface ScriptLiteralTarget {
    uri: string;
    label?: string;
}
export interface ScriptLiteralTargetIndexes {
    numeric: Map<number, ScriptLiteralTarget[]>;
    strings: Map<string, ScriptLiteralTarget[]>;
}
export interface ScriptReferenceBuildResult {
    edges: ReferenceEdge[];
    diagnostics: Diagnostic[];
    /** Enriched call occurrences per script uri (consumed by T08 service assembly). */
    callsByScriptUri: Map<string, ScriptCallOccurrence[]>;
    stats: {
        confirmed: number;
        hypotheses: number;
        dynamicArgs: number;
        /** Scripts whose source could not be lexed/parsed completely. */
        unparsedScripts: number;
        /** Children without decodable source text (bytecode / catalog-only / view). */
        nonSourceChildren: number;
        containersWithCompleteCatalog: number;
        containersWithPartialCatalog: number;
    };
}
/**
 * 显式 API 语义规则：callee 名（精确匹配）、字面量参数位置、引用命名空间。
 * 目前仓库可追溯的语义只有语言级 `require`；游戏 API 规则必须附出处后才能
 * 加入，不允许凭名称相似猜语义（§T06 步骤 7）。
 */
interface ScriptApiRule {
    ruleId: string;
    callee: string;
    argPosition: number;
    namespace: 'script-module';
    source: string;
}
export declare const SCRIPT_API_RULES: readonly ScriptApiRule[];
export declare function buildScriptReferenceEdges(scriptExports: readonly ScriptExport[], options?: ScriptReferenceBuildOptions): ScriptReferenceBuildResult;
export {};
