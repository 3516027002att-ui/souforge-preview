/**
 * SF-07 专项审计与冒烟测试 (runAuditSf07Smoke.ts)
 *
 * 依据：《SoulForge 全域审查与演进研究报告》与执行施工图 tasks/SF-07.md。
 * 验证：
 * 1. NativeEvidenceContract 身份键 (computeEvidenceKey / computeEvidenceResourceKey) 确定性与无冲突
 * 2. utf8CodepointPrefix 多字节 UTF-8 (CJK 与 4-byte 代理对 Emoji/罕见字) 安全截断
 * 3. budgetStructuredJson 结构化裁剪与 RESULT_IDENTITY_TOO_LARGE 快速失败保护
 * 4. 字段四态分类 (native_value, derived_value, external_metadata, display_label) 与 FIELD_KIND_NON_NATIVE 拦截
 * 5. 跨域编辑越界拦截 (DOMAIN_CROSSOVER_REJECTED) 及工具门禁
 * 6. ReadSession 与 opaque cursor 分页连续性、STALE_READ_CURSOR 失效与 NATIVE_OFFSET_CRAFTING_FORBIDDEN 拦截
 * 7. 写入前置条件与读取覆盖验证 (READ_COVERAGE_INCOMPLETE / assertWritePrecondition)
 * 8. 验收项 T19 (FMG 目标隔离), T24 (大事件分页 continuationParams), T27 (TAE 共享时间槽隔离), T43 (RAG family 过滤)
 * 9. Native 真实资源读取、信封契约、游标分页与跨版本失效验证
 */
export declare function runAuditSf07UnitTests(): Promise<void>;
export declare function runAuditSf07NativeTests(): Promise<void>;
