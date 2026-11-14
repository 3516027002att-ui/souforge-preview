/**
 * 地图连接 provider（T07，执行指令 §T07 步骤 1-5、7）。
 *
 * 关系只来自原生 reader 已导出的字段：
 * - 实体 → PARAM 行：`raw.npcParamRowId` / `raw.thinkParamRowId` 这类真实外键
 *   字段存在且在当前索引中唯一命中目标行时才生成 confirmed 边；字段缺失就是
 *   没有该关系，不从部件名称反算（步骤 1）。
 * - 每个实例独立身份：遍历全部实体，不做 `.find()` 首实例截断（步骤 2）；
 *   同模型的两个实例绝不因 model 相同而合并。
 * - entityId / internalEntryId / nativeOffset / model / name 各自保留语义，
 *   不得互相代换（步骤 3）；entityId 在同图命中多个实例时返回歧义诊断。
 * - 位置只是实例所在说明，不进入关系主键（步骤 5）。
 * - 地图文件与同名事件文件只是搜索范围关系；"事件控制某角色"必须由事件侧
 *   typed entity/region 参数证明（eventReferenceProvider 负责），这里不生成
 *   任何 confirmed 的 map↔event 边（步骤 4）。
 * - 名称前缀等模式只进入 `includeHypotheses` 通道，low + 规则名（步骤 7）。
 */
import type { Diagnostic, MapExport, ParamExport, ReferenceEdge } from '@soulforge/shared';
export interface MapReferenceBuildOptions {
    includeHypotheses?: boolean;
}
export interface MapReferenceBuildResult {
    edges: ReferenceEdge[];
    diagnostics: Diagnostic[];
    stats: {
        confirmed: number;
        hypotheses: number;
        ambiguousEntityIds: number;
        danglingForeignKeys: number;
        instances: number;
    };
}
export declare function buildMapReferenceEdges(maps: readonly MapExport[], params: readonly ParamExport[], options?: MapReferenceBuildOptions): MapReferenceBuildResult;
