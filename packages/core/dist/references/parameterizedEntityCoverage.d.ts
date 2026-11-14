/**
 * “看不见的实参”是否阻止否定结论。
 *
 * 事件参数索引只把**字面量**引用实参（entityId / eventId / textId …）归到具体对象；
 * 实参来自公共事件形参（`X<offset>_<width>`）的调用无法归属，只能计数。
 * 因此“索引里没有该对象的字面量引用”不等于“该对象没有被引用”：
 * 只要**本次查询相关的引用通道**存在这种无法归属的调用，其中任意一条都可能正指向
 * 查询目标，否定结论必须降级（inconclusive），不能输出成“没有”。
 *
 * 与 `explain_miniboss` 的判定保持同一语义：只有相关通道（以及可选的指令类、
 * 地图/来源范围）才阻止否定；参数化调用属于其它通道时与本次查询无关，否定结论
 * 仍成立（并由调用方写明理由）。
 *
 * 三个通道（见 `eventInstructionIndex.ts` 的 `ParameterizedArgRole`）：
 * - entity：地图 part / region 被 `entityId` / `targetEntityId` 引用；
 * - event：事件被 `eventId` 等实参调用；
 * - text：FMG 条目被 `messageId` / `nameId` 等文本实参引用。
 */
import type { EventInstructionIndexFileCoverage, ParameterizedArgRole } from './eventInstructionIndex.js';
export interface ParameterizedCoverageQuery {
    files: readonly EventInstructionIndexFileCoverage[];
    /** 本次查询依赖的引用通道；默认 entity（历史行为）。 */
    role?: ParameterizedArgRole;
    /** 精确指令名（argument 分支的 instruction 过滤）。 */
    instructionName?: string;
    /** 指令名子串（argument 分支的 query / 指令名检索）。 */
    instructionContains?: string;
    /** 只统计该来源文件（file 过滤）。 */
    sourceUri?: string;
    /** 只统计该地图的事件文件（地图 part/region 的查询范围）。 */
    mapId?: string;
}
export interface ParameterizedInstructionCount {
    name: string;
    count: number;
}
export interface ParameterizedEntityCoverage {
    /** 本次查询依赖的引用通道。 */
    role: ParameterizedArgRole;
    /**
     * instruction：按精确指令名判断；
     * instruction-contains：按指令名子串判断；
     * any：查询没有限定指令类，任何该通道的参数化调用都可能指向目标。
     */
    scope: 'instruction' | 'instruction-contains' | 'any';
    /** 本次查询相关、且存在参数化实参的指令类（按条数降序、名称升序）。 */
    relevantInstructions: ParameterizedInstructionCount[];
    relevantCount: number;
    /** 索引（或 file/map 限定的范围）内全部该通道参数化调用条数。 */
    totalCount: number;
    /** 存在该通道参数化实参、但不属于本次查询指令类的指令（用于说明“与本次查询无关”）。 */
    unrelatedInstructions: ParameterizedInstructionCount[];
    /** 范围内**其它通道**的参数化调用条数：它们与本次查询无关，用于写明理由。 */
    otherRoleCount: number;
    /** 范围内实际参与统计的事件文件数（0 表示该范围没有被索引覆盖）。 */
    filesInScope: number;
    /** 范围内读取失败的事件文件数；>0 时该范围本身就不完整。 */
    filesUnread: number;
    /** true：相关通道存在无法归属的实参，否定结论不可用。 */
    blocksNegative: boolean;
}
export declare function assessParameterizedEntityCoverage(input: ParameterizedCoverageQuery): ParameterizedEntityCoverage;
