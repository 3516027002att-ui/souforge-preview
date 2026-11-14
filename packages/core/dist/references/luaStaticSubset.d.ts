/**
 * 受限 Lua 词法 + 静态子集解析（执行指令 §T06 步骤 4/5/6/7）。
 *
 * 这里是源码引用图的静态语法补充层；HKS 字节码的完整反编译/回编译由 Bridge
 * 内置 first-party dialect 负责，本模块不执行 Lua，也不把源码引用分析冒充 native
 * 字节码覆盖。`scriptContainerEvidence` 只做容器级 magic 清点，因此这里新增一个**只读静态
 * 子集**解析器。它不执行 Lua、不引入解释器，也不试图覆盖完整语法：解析不了的
 * 位置显式记为诊断，绝不静默当作“没有调用”。
 *
 * 子集必须区分（§T06 步骤 5）：行注释、长注释、单/双引号字符串、长字符串、
 * 数字、标识符、函数定义、调用表达式、局部声明、成员调用。所有调用节点由
 * token + source span 构造 —— 生产证明禁止用全文件正则抓 `name(number)`。
 *
 * 遮蔽语义（§T06 步骤 6）：
 * - `function NAME(...)` / `local function NAME(...)` 是定义，不是调用。
 * - 字符串与注释里的函数名不产生调用（词法层已排除）。
 * - 块作用域内的 `local` 同名声明遮蔽全局 API：被遮蔽的调用标 `isLocal`，
 *   永不生成“已确认游戏 API 引用”。
 */
import type { ScriptStructureIndex } from '@soulforge/shared';
export type LuaTokenType = 'name' | 'number' | 'string' | 'keyword' | 'punct';
export interface LuaToken {
    type: LuaTokenType;
    /** Raw source slice for the token (strings keep their quotes). */
    value: string;
    /** Zero-based absolute character offset of the first token character. */
    start: number;
    /** Zero-based absolute character offset one past the last character. */
    end: number;
}
export interface LuaSpan {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    startOffset: number;
    endOffset: number;
}
export interface LuaParseDiagnostic {
    severity: 'warning' | 'error';
    code: string;
    message: string;
    span?: LuaSpan;
}
export type LuaArgKind = 'literal' | 'name' | 'member' | 'table' | 'expression';
export interface LuaArg {
    kind: LuaArgKind;
    /** Exact source slice of this argument — never rewritten. */
    text: string;
    span: LuaSpan;
    /** Present only when the argument is a bare literal token. */
    literal?: string | number | boolean | null;
}
export interface LuaCall {
    /** Dotted/colon callee chain as written, e.g. `a.b.c`. */
    callee: string;
    /** First identifier of the chain — the symbol looked up for shadowing. */
    rootName: string;
    calleeSpan: LuaSpan;
    /** Span of the whole call expression, including parentheses. */
    span: LuaSpan;
    args: LuaArg[];
    /** True when the callee root is a local symbol in scope at the call site. */
    isLocal: boolean;
    /** True when a local in scope shadows a global of the same name. */
    shadowedGlobal: boolean;
    /** True for a `require`-style module-load call. */
    isRequire: boolean;
}
export interface LuaLocalBinding {
    name: string;
    /** Literal value when `local NAME = <literal>`; absent for other forms. */
    literal?: string | number | boolean | null;
    /** True when the binding is a function definition. */
    isFunction: boolean;
    /** Set when the name is re-assigned later — the literal is no longer unique. */
    modified: boolean;
    /** Depth of the scope frame the binding lives in (for shadow lookups). */
    depth: number;
    span: LuaSpan;
}
export interface LuaParseResult {
    calls: LuaCall[];
    /** Every local binding recorded during the scan, with its declaring scope. */
    bindings: LuaLocalBinding[];
    /** Statements we deliberately did not interpret (bounded static subset). */
    diagnostics: LuaParseDiagnostic[];
    /** True when the file could not be lexed to completion. */
    lexTruncated: boolean;
}
/** Build the source-only structural layer used by the Agent. */
export declare function buildLuaStructureIndex(text: string, parsed?: LuaParseResult): ScriptStructureIndex;
export declare function tokenizeLua(text: string): {
    tokens: LuaToken[];
    diagnostics: LuaParseDiagnostic[];
};
/** Line start offsets computed once; spans are derived, never guessed. */
export declare function lineOffsets(text: string): number[];
export declare function spanFromOffsets(text: string, start: number, end: number, offsets: number[]): LuaSpan;
/**
 * Parse the bounded static subset. The walker is statement-oriented and
 * deliberately conservative: anything it cannot classify is recorded in
 * `diagnostics` instead of being silently skipped.
 */
export declare function parseLuaStaticSubset(text: string): LuaParseResult;
/** Decode a quoted or long-bracket Lua string literal to its content. */
export declare function decodeLuaString(raw: string): string;
export declare function parseLuaNumber(raw: string): number | null;
