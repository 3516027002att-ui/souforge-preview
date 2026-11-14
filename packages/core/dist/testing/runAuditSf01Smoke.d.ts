/**
 * SF-01 执行卡专项测试入口 (runAuditSf01Smoke.ts)
 *
 * 依据：《SoulForge 全域审查与演进研究报告》与执行施工图 tasks/SF-01.md。
 * 派发 --layer unit|native：
 *  - unit：验证 validateMapTransaction 及 Blender delta 对三类危险操作的切断及错误码断言。
 *  - native：调用 runAuditMsbSafetyGateSmoke 执行真实 Bridge 安全拦截测试。
 */
export {};
