/**
 * DarkScript3-style EMEVD source renderer.
 *
 * Renders an EmevdEditorDocument (bound to an EMEDF registry) into the
 * DarkScript3 / MattScript source shape the user ruled for the event
 * workbench (R3/P4):
 *
 *   $Event(0, Default, function() {
 *       InitializeEvent(0, 77770001, 0);
 *       ...
 *   });
 *
 *   $Event(965672, Restart, function() {
 *       WaitFor(
 *           PlayerHasItem(ItemType.Goods, 2498)
 *           && CharacterHasSpEffect(10000, 127800)
 *           && CharacterHasSpEffect(10000, 110140));
 *       WaitFixedTimeFrames(3);
 *       ...
 *   });
 *
 * Instruction names come from EMEDF (never the raw bank:id hash), and every
 * name is PascalCased. When the bound registry has no definition for an
 * instruction, or the payload does not decode, the renderer fails closed into
 * an honest `// unknown ...` / `// <code> ...` comment instead of fabricating
 * a function call. This module is a pure function of (document, registry):
 * no filesystem, no mutation, no side effects.
 *
 * Condition folding (see `splitIntoSpans` / `predicatesBefore` below for the
 * full rule):
 *
 * Real Sekiro EMEDF has no "IF OR Condition Group"-style instruction — every
 * condition predicate (bank 0..13, e.g. "IF Player Has Item",
 * "IF Character Has SpEffect") carries a `Result Condition Group` slot, and the
 * logical operators are expressed only through *which* condition group each
 * predicate writes to, plus the group-join instruction that plugs a sub-group
 * into the MAIN group (0). DarkScript3's own decompiler reconstructs `&&` / `||`
 * from a full control-flow-graph + condition-group data-flow analysis; the
 * AND/OR distinction is encoded in the group *numbering convention* (and## /
 * or##) which is lost in the binary. We therefore only fold the one case that
 * is decidable from linear structure alone, and fall back to plain per-
 * instruction calls in every other case:
 *
 *   - a "wait block" is anchored by `IF Condition Group` (bank 0, id 0) whose
 *     result group is MAIN (0), or by `WAIT For Condition Group State`
 *     (bank 1000, id 0) whose target group is MAIN (0);
 *   - every predicate immediately preceding the anchor that writes to *the same
 *     non-MAIN* result condition group is joined with `&&`;
 *   - anything else (multiple distinct sub-groups, interleaved non-predicate
 *     instructions, predicates writing back to an Or-group) is NOT folded — the
 *     instructions are rendered as ordinary calls, which never fabricates
 *     boolean structure.
 */
import type { EmevdEditorDocument, EmevdEventIr, EmevdInstructionIr } from '@soulforge/shared';
import { type DecodedArg, type EmedfRegistry } from './emedfSchema.js';
import type { BoundedEmevdPatchDsl } from './dslRenderer.js';
/**
 * Render a full DarkScript3 source view (unbounded).
 */
export declare function renderEmevdDarkScript(document: EmevdEditorDocument, registry: EmedfRegistry): string;
/**
 * Bounded DarkScript3 renderer. Truncation happens only at an event-block
 * boundary (`});`), mirroring the dslRenderer approach, so the visible text
 * stays a well-formed prefix of the source. The trailing marker is a comment.
 */
export declare function renderEmevdDarkScriptBounded(document: EmevdEditorDocument, registry: EmedfRegistry, lineLimit: number | undefined): BoundedEmevdPatchDsl;
export interface RenderEmevdDarkScriptAsyncOptions {
    /** 取消信号。每次让出前后各查一次；取消不返回半成品源码。 */
    signal?: AbortSignal;
    /** 单个同步切片的软预算（毫秒），缺省 8。 */
    sliceBudgetMs?: number;
    /** 至多连续渲染多少个事件才强制查一次时钟，缺省 64。 */
    eventsPerClockCheck?: number;
}
export interface RenderEmevdDarkScriptAsyncResult extends BoundedEmevdPatchDsl {
    /** 被取消。取消时 `text` 恒为空串，不返回半成品。 */
    cancelled: boolean;
}
/**
 * 分片异步反汇编。输出与 `renderEmevdDarkScriptBounded(document, registry, undefined)`
 * 逐字节相同。
 *
 * 为什么需要它：真实 common.emevd（1730 事件 / 33266 指令）同步渲染约 75 ms，
 * 这 75 ms 里主进程事件循环完全停摆 —— 期间到达的 IPC、定时器、取消信号都排队等着。
 * 打开事件文档正是用户最可能马上切走的时刻，而那一刻的取消信号恰好被这段同步任务
 * 堵在队列里，等它跑完才被看见，于是「取消」变成「取消不掉」。
 *
 * 做法是协作式让出：按事件（不是按行、不是按指令）累积字符串块，每约
 * `sliceBudgetMs` 毫秒 `setImmediate` 让一次，让出前后各查一次 signal。事件是最小
 * 不可分单位 —— 折叠判定要看整段指令流，切在事件中间会改变输出。
 *
 * 复用同步侧的 `renderEventLines` 与 `finalizeUntruncated`，没有第二套输出规则：
 * 失败注释、unknown 指令、WaitFor 折叠、行数、尾换行都由同一份代码决定。
 *
 * 只做无界渲染：production 入口（ipc.ts）T4 之后就传 undefined 行上限，截断路径
 * 只剩同步调用方（core smoke）在用，没必要复制一份截断逻辑。
 */
export declare function renderEmevdDarkScriptAsync(document: EmevdEditorDocument, registry: EmedfRegistry, options?: RenderEmevdDarkScriptAsyncOptions): Promise<RenderEmevdDarkScriptAsyncResult>;
/**
 * Render one event into `$Event(<id>, <Default|Restart>, function() { ... });`.
 * The event header line is NOT indented (DarkScript3 top-level style); the
 * closing `});` is a standalone line at column 0.
 *
 * 导出给 darkScriptCompiler：编译器按「反汇编形状」把用户编辑后的 `$Event`
 * 文本与文档逐事件逐行对齐，必须与渲染侧共用同一份行切分与折叠判定。
 */
export declare function formatEventParameters(parameters?: Array<{
    sourceStartByte: number;
    byteCount: number;
}>): string[];
/**
 * Render one event into `$Event(<id>, <Default|Restart>, function(X0_4, ...) { ... });`.
 * The event header line is NOT indented (DarkScript3 top-level style); the
 * closing `});` is a standalone line at column 0.
 *
 * 导出给 darkScriptCompiler：编译器按「反汇编形状」把用户编辑后的 `$Event`
 * 文本与文档逐事件逐行对齐，必须与渲染侧共用同一份行切分与折叠判定。
 */
export declare function renderEventLines(event: EmevdEventIr, registry: EmedfRegistry): string[];
/**
 * restBehavior 0 → Default, 1 → Restart; any other value is rendered verbatim
 * with a comment flagging it as an unrecognized rest behavior.
 */
export declare function formatRestBehavior(restBehavior: number): string;
/**
 * Render one decodable instruction as `Name(arg1, arg2, ...);`.
 * Unknown instructions and decode failures become honest comments.
 *
 * 输入是 decodeForRender 的结果（每条指令只解码一次），三种失败态的注释文本与
 * 单次解码前逐字相同：unknown / BASE64_INVALID / <原始 code>。
 *
 * 导出给 darkScriptCompiler：普通指令行的 canonical 形状由这里决定。
 */
export declare function renderInstructionLine(item: DecodedInstruction): string;
export type Span = {
    kind: 'ordinary';
    instructions: DecodedInstruction[];
} | {
    kind: 'wait-block';
    predicates: DecodedInstruction[];
    anchor: DecodedInstruction;
};
/**
 * 解码一条指令的结果。`status` 让渲染阶段不必重新解码就能写出与失败原因一致的
 * 注释：
 *   'unknown'        → instruction.unknown 或 registry 无该 bank:id 定义
 *   'base64-invalid' → argsBase64 不是严格 base64
 *   'decode-failed'  → 结构性解码失败（长度签名不符等），code 是原始错误码
 *   'ok'             → args 可用
 *
 * 折叠判定（isPredicate / isWaitAnchor / firstNamedArg）只看 args，失败态 args
 * 恒为空数组，因此三种失败态都自然地不可折叠 —— 与单次解码前的行为一致。
 */
type DecodeStatus = {
    kind: 'ok';
} | {
    kind: 'unknown';
} | {
    kind: 'base64-invalid';
} | {
    kind: 'decode-failed';
    code: string;
};
export interface DecodedInstruction {
    instruction: EmevdInstructionIr;
    bank: number;
    id: number;
    /** EMEDF 原始指令名（未 PascalCase）；失败态为空串。 */
    name: string;
    args: DecodedArg[];
    status: DecodeStatus;
}
/**
 * Split a linear event body into ordinary runs and folded wait-blocks.
 *
 * Anchors and predicates are recognized structurally from the EMEDF *argument
 * names*, so the rule holds for any imported Sekiro EMEDF without hardcoding
 * bank:id beyond the two anchor instructions whose semantics are fixed by the
 * file format:
 *
 *   anchor A — `IF Condition Group` (bank 0, id 0): first arg is the result
 *     condition group, last arg is the target condition group. A wait folds the
 *     MAIN group when result group === 0.
 *   anchor B — `WAIT For Condition Group State` (bank 1000, id 0): its target
 *     condition group === 0 evaluates the MAIN group (WaitFor).
 *
 * A predicate is any decoded instruction whose FIRST argument name matches
 * /resultconditiongroup/i (e.g. `resultConditionGroup`, `resultConditionGroupId`).
 * Predicates write to the same non-MAIN group and are joined with `&&`.
 */
export declare function splitIntoSpans(instructions: EmevdInstructionIr[], registry: EmedfRegistry, parameters?: EmevdEventIr['parameters']): Span[];
/**
 * Render a folded wait-block as `WaitFor(p1 && p2 && ...)`. The anchor itself —
 * `IF Condition Group` / `WAIT For Condition Group State` — is the low-level
 * spelling of `WaitFor(MAIN)`, so it becomes the `WaitFor(` wrapper instead of
 * a standalone line. Predicate condition-group bookkeeping args are hidden
 * (their purpose is expressed by the fold); remaining args render as values.
 *
 * Returns one element per source line; `renderEventLines` applies the shared
 * 4-space event-body indent, so a line carrying an extra `INDENT` lands at the
 * 8-space continuation column that matches the DarkScript3 example.
 */
export declare function renderWaitBlock(span: {
    predicates: DecodedInstruction[];
    anchor: DecodedInstruction;
}): string[];
/** 与反汇编输出同一套 PascalCase，编译器按这个名字回对齐指令。 */
export declare function darkScriptInstructionName(name: string): string;
export type DarkScriptEventItem = {
    kind: 'call';
    instruction: EmevdInstructionIr;
    displayName: string;
    args: DecodedArg[];
} | {
    kind: 'wait-for';
    predicates: Array<{
        instruction: EmevdInstructionIr;
        displayName: string;
        visibleArgs: DecodedArg[];
    }>;
    anchor: EmevdInstructionIr;
} | {
    kind: 'opaque';
    instruction: EmevdInstructionIr;
    comment: string;
};
/**
 * 把一个事件拆成与反汇编逐行对应的形状，供 DarkScript 编译器按位置对齐。
 * 折叠规则与 `renderEventLines` 共用 `splitIntoSpans`，禁止第二套 WaitFor 判定。
 */
export declare function analyzeDarkScriptEvent(event: EmevdEventIr, registry: EmedfRegistry): DarkScriptEventItem[];
export declare function toPascalCase(name: string): string;
/**
 * 每条指令只解码一次。折叠判定与行渲染共用同一份结果 —— 之前 splitIntoSpans 与
 * renderInstructionLine 各自解码一遍（base64 + decodeInstructionArgs），
 * 33266 条指令等于付两倍成本。
 */
export declare function decodeForRender(instruction: EmevdInstructionIr, registry: EmedfRegistry, instructionIndex?: number, parameters?: EmevdEventIr['parameters']): DecodedInstruction;
export {};
