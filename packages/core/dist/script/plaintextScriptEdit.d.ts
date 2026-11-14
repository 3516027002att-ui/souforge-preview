/**
 * 明文脚本条目的源码级编辑编排。
 *
 * 当前 Sekiro 1.6.x 范围同时允许已通过 first-party HKS coverage gate 的
 * 字节码条目进入源码编辑；不属于当前 dialect 的字节码必须由上层返回结构化
 * `not-attempted/blocked` 诊断，不能走这里的明文编码回退。
 *
 * ── 为什么不新建 writer ──
 *
 * 源码级编辑不是一条新的写路径,它是「读明文 → 改文本 → 编回字节 → 走既有
 * container_child_replace」。既有 ContainerChildReplaceWriter 已经带
 * expectedContainerHash / expectedChildHash 前置条件、只写暂存区、
 * 并在 staging 后经 Bridge 观测。另建一条写路径等于绕过那些保证,
 * 也违反硬约束「所有 Mod 资源写入必须经 Patch Engine」。
 *
 * 本模块只做三件事,一件都不落到磁盘:
 *   ① 拿真实字节判定目标条目是不是明文(拒绝字节码,不看文件名);
 *   ② 按声明的编辑动作产出新文本,并用同一编码编回字节;
 *   ③ 产出带哈希前置条件的 PatchIR 操作,交给 Patch Engine。
 *
 * 读取源字节的容器路径由调用方给出,本模块不写它;产出的操作只描述
 * 当前打开工作区里的目标。写入闸门由 Patch Engine 与 allowedRoots 强制,
 * 本模块不重复实现,也不提供任何绕过参数。
 */
import type { ContainerChildOp, StructuredDiagnostic } from '@soulforge/shared';
import { type PlaintextEncoding, type PlaintextVerdict } from './plaintextScriptEntry.js';
/**
 * 一次源码级编辑动作。
 *
 * `replace-once` 要求 `find` 在原文里**恰好出现一次**。不提供
 * 「替换全部」:一个在文件里出现 40 次的字符串,替换全部的后果无法在审批
 * 卡片上被看清,而看不清的改动不该被批准。要改多处就发多条动作,每条各自
 * 带上足以唯一定位的上下文。
 *
 * `set-whole-text` 是整条目文本替换。它仍然经明文判定与编码校验,
 * 与「整文件字节替换」的区别是:后者可用于字节码,前者只用于明文且保编码。
 */
export type PlaintextEditAction = {
    kind: 'replace-once';
    find: string;
    replace: string;
} | {
    kind: 'set-whole-text';
    text: string;
}
/**
 * 纯 ASCII 字节级替换:`find` 与 `replace` 都必须是纯 ASCII,替换在**字节**层
 * 完成,不做整篇解码-编码往返。
 *
 * 为什么需要这条路径:混合编码条目(既非 UTF-8 也非完整 Shift-JIS)此前被
 * 一律拒绝,理由是「任何单一编码的往返都会丢字节」。那个理由只对**整篇往返**
 * 成立 —— 实测 801000_battle.lua 有 2740 行纯 ASCII、仅 6 行含非 ASCII,
 * 在纯 ASCII 区域做字节替换后 52 个非 ASCII 字节**完全不变**。
 *
 * 也就是说文件本身可以无损编辑,是我的实现强制了往返。区别在于:解码是
 * 为了「按文本理解内容」,而改一处 `act[26] = 100` 并不需要理解那 6 行日文/中文
 * 注释 —— 不碰就不必解得开。
 */
 | {
    kind: 'replace-ascii-bytes';
    find: string;
    replace: string;
};
export interface PlaintextScriptEditInput {
    /** 外层容器 URI(用于 PatchIR 溯源)。 */
    containerUri: string;
    /** 条目名(BND4 内层名的 basename)。 */
    childPath: string;
    /** 条目在 BND4 条目表里的索引。 */
    entryIndex: number;
    /** 条目当前的真实字节。必须由调用方经 Bridge 取得,不是猜的。 */
    currentBytes: Uint8Array;
    /** 外层容器文件当前 sha256,作为写入前置条件。 */
    expectedContainerHash: string;
    /** 容器格式标记(如 DCX-DFLT->BND4),透传给 writer。 */
    containerFormat?: string;
    actions: PlaintextEditAction[];
}
export type PlaintextScriptEditResult = {
    ok: true;
    operation: ContainerChildOp;
    verdict: PlaintextVerdict;
    encoding: PlaintextEncoding;
    /** 编辑前后的字节数,供审批卡片显示改动规模。 */
    beforeBytes: number;
    afterBytes: number;
    /** 编辑前后的 sha256;afterHash 用于写后重读比对。 */
    beforeHash: string;
    afterHash: string;
    appliedActions: number;
    diagnostics: StructuredDiagnostic[];
} | {
    ok: false;
    code: string;
    message: string;
    /** 判定结果在失败时也返回:调用方需要知道「为什么不算明文」。 */
    verdict?: PlaintextVerdict;
    diagnostics: StructuredDiagnostic[];
};
/**
 * 产出一条源码级编辑的 PatchIR 操作。
 *
 * 不写任何文件。返回的操作要交给 Patch Engine 才会落到暂存区。
 */
export declare function buildPlaintextScriptEdit(input: PlaintextScriptEditInput): PlaintextScriptEditResult;
export interface PlaintextWritebackCheckInput {
    /** 计划阶段算出的目标 sha256。 */
    expectedAfterHash: string;
    /** 提交后经 Bridge 重新读回的条目字节。 */
    reReadBytes: Uint8Array;
    /** 计划阶段判定的编码;重读结果的编码必须一致。 */
    expectedEncoding: PlaintextEncoding;
}
export type PlaintextWritebackCheckResult = {
    ok: boolean;
    code: string;
    message: string;
    actualHash: string;
    actualEncoding: PlaintextEncoding;
    diagnostics: StructuredDiagnostic[];
};
/**
 * 写后重读比对。
 *
 * 为什么必须重读而不是相信 writer 的返回值:容器写入要经过 BND4 重打包与
 * DCX 压缩,「我写进去的字节」和「再读出来的字节」中间隔着两层编解码。
 * 只信 writer 回报成功,等于把「重打包是否无损」这件事当成假设。
 *
 * 编码也要复验:一个把 Shift-JIS 写成 UTF-8 的缺陷不会改变字节数级别的
 * 校验结果(哈希会变,但如果哈希算的是同一份错字节就发现不了),
 * 独立判一次编码能抓到「哈希对得上但内容语义已变」。
 */
export declare function checkPlaintextWriteback(input: PlaintextWritebackCheckInput): PlaintextWritebackCheckResult;
