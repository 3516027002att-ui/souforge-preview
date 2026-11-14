/**
 * 明文脚本条目源码级写的**端到端** smoke:
 * 真实容器 → 明文判定 → 源码级编辑 → Patch Engine 提交 → Bridge 重读校验 → 回滚。
 *
 * ── 为什么必须单独有这一层 ──
 *
 * `runPlaintextScriptEditSmoke` 验的是判定与编排:它产出 PatchIR 操作就结束,
 * 自己的 nonClaim 写着「不写入任何真实 Mod 资源」。实测确认过那个文件里
 * `executePatchIrThroughTransaction` / `runBridge` 的出现次数是 **0**。
 *
 * 也就是说「走 Patch Engine、写后 Bridge 重读校验、可回滚」这条要求,此前
 * 每个零件都实现了、也都单独测过,但**没有一次真实写入走完整条链**。
 * `checkPlaintextWriteback` 的三个用例喂的是手工构造的字节,不是从容器里
 * 读回来的 —— 那证明不了「写进去的和读出来的是同一份内容」,而那正是
 * 容器重打包 + DCX 压缩这两层编解码之后最需要证明的事。
 *
 * ── 只读原版游戏目录 ──
 *
 * 真实容器**复制**到临时 overlay 再改,与 runNativeScriptContainerReplaceSmoke
 * 同形。原版游戏目录只被读取一次(复制源),全程不写。
 *
 * ── 无语料时 ──
 *
 * 结构化跳过并说明「未执行不等于通过」。这条 smoke 的价值全在真实语料上,
 * 用 synthetic 容器跑通不能替代它 —— 要证明的恰好是真实 BND4+DCX 的往返。
 */
export interface PlaintextEntryOutcome {
    target: string;
    kind: 'container-entry' | 'bare-file';
    encoding: string;
    beforeBytes: number;
    afterBytes: number;
    writebackCode: string;
    rollbackByteIdentical: boolean;
}
export interface PlaintextWriteSmokeResult {
    ok: boolean;
    message: string;
    skipped?: string;
    /** 目标**文件**总数(不含工具链那一条)。 */
    fileTargetsTotal?: number;
    /** 文件侧通过数。与 fileTargetsTotal 同类可比。 */
    fileVerifiedCount?: number;
    /** 工具侧通过数(propose_plaintext_script_edit 的完整链)。 */
    toolVerifiedCount?: number;
    /** 每个被验证的明文条目一条。 */
    verified: PlaintextEntryOutcome[];
    /** 有语料但被跳过的条目及原因。 */
    unverified: Array<{
        target: string;
        reason: string;
    }>;
    nonClaims: string[];
}
export declare function runPlaintextScriptWriteSmoke(): Promise<PlaintextWriteSmokeResult>;
