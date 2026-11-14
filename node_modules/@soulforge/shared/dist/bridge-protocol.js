export const BRIDGE_SCHEMA_VERSION = '1.0.0';
export const BRIDGE_PROTOCOL_VERSION = '1.0.0';
/**
 * 暂存区写入成功的诊断码：写入类命令的**唯一**成功判据。
 *
 * 为什么必须集中声明：生产侧五条写路径各自内联一个字符串字面量
 * （fmg/param/emevd/msbBridgeCommit.ts 与 writers/containerChildReplaceWriter.ts
 * 都写成 `d.code === 'X_STAGING_WRITE_VERIFIED'`），而这些码由 C# 的
 * BridgeCommandService 发出。两侧靠字面量恰好相同来耦合：**C# 改一个码名，
 * 写入会静默变成 ok:false——没有编译错误，也没有任何公开层的测试失败**，
 * 症状只是「用户点保存没反应」。断言这些码的 9 个 smoke 全部在 native 层，
 * 需要私有游戏语料，公开 CI 结构上跑不到。
 *
 * 这里是那对耦合的单一声明点：TS 侧从此引用常量而不是内联字面量，
 * 而 test:bridge-write-boundary 在真实 daemon 上观测到这些码确实被发出，
 * 并与 C# 源码里的码名双向对账（缺一即失败关闭）。
 *
 * 注意语义边界：这些码只表示「已写入暂存区并重读验证」，它**不表示**
 * 该格式具备 native writer authority，也不表示往返无损。
 */
export const BRIDGE_STAGING_WRITE_VERIFIED_CODES = Object.freeze({
    fmg: 'FMG_STAGING_WRITE_VERIFIED',
    param: 'PARAM_STAGING_WRITE_VERIFIED',
    emevd: 'EMEVD_STAGING_WRITE_VERIFIED',
    msb: 'MSB_STAGING_WRITE_VERIFIED',
    bnd4: 'BND4_STAGING_WRITE_VERIFIED',
    gparam: 'GPARAM_STAGING_WRITE_VERIFIED',
    flver: 'FLVER_STAGING_WRITE_VERIFIED',
    tpf: 'TPF_STAGING_WRITE_VERIFIED',
    mtd: 'MTD_STAGING_WRITE_VERIFIED',
    esd: 'ESD_STAGING_WRITE_VERIFIED',
    tae: 'TAE_STAGING_WRITE_VERIFIED',
    fxr: 'FXR_STAGING_WRITE_VERIFIED'
});
export function createBridgeEnvelope(partial) {
    const envelope = {
        schemaVersion: partial.schemaVersion ?? BRIDGE_SCHEMA_VERSION,
        protocolVersion: partial.protocolVersion ?? BRIDGE_PROTOCOL_VERSION,
        command: partial.command,
        ok: partial.ok,
        partial: partial.partial,
        diagnostics: partial.diagnostics,
        nativeFormatAuthority: partial.syntheticFixture ? false : partial.nativeFormatAuthority,
        syntheticFixture: partial.syntheticFixture
    };
    if (partial.data !== undefined)
        envelope.data = partial.data;
    if (partial.failure !== undefined)
        envelope.failure = partial.failure;
    if (partial.confidence !== undefined)
        envelope.confidence = partial.confidence;
    if (partial.provenance !== undefined)
        envelope.provenance = partial.provenance;
    if (partial.capabilityHints !== undefined)
        envelope.capabilityHints = partial.capabilityHints;
    return envelope;
}
export function createSyntheticBridgeFailure(code, message, kind = 'unsupported') {
    return {
        kind,
        code,
        message,
        retryable: false,
        diagnostics: [{
                severity: kind === 'partial' ? 'warning' : 'error',
                code,
                message,
                recordedAt: new Date().toISOString()
            }]
    };
}
//# sourceMappingURL=bridge-protocol.js.map