/**
 * SF-01 MSB 安全门禁原生测试 (runAuditMsbSafetyGateSmoke.ts)
 *
 * 依据：《SoulForge 全域审查与演进研究报告》与执行施工图 tasks/SF-01.md。
 * 验证三类危险操作直达 Bridge write-msb 时必须 fail-closed：
 *  1) set_entity_id / set_property(entityId) -> MSB_ENTITY_SCHEMA_UNVERIFIED
 *  2) Region 任何 scale 字段 -> MSB_REGION_SCALE_UNSUPPORTED
 *  3) delete_part / delete_region / delete_event -> MSB_REFERENCE_COVERAGE_INCOMPLETE
 *  4) 正常 Part 平移和正常 Region 平移依然成功，不破坏正常写链。
 */
export declare function runAuditMsbSafetyGateSmoke(): Promise<{
    ok: boolean;
    message: string;
    testedNegativeGates: string[];
    testedPositiveControls: string[];
}>;
