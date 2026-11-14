/**
 * 容器 contains / 成员 member_of provider（T07，执行指令 §T07 步骤 10）。
 *
 * 只为原生 reader 已公开"完整子项身份"的容器发布成员关系：
 * - TAE：ANIBND 内原生 TAE 子项目录（`TaeExport.taeEntries` 的
 *   entryIndex/entryId/entryName/sourceHash）。动画 → 所属 TAE 子项用
 *   `taeEntryIndex` 寻址 —— animId 不能单独寻址，跨 section 同号必须可区分。
 * - FMG/MSGBND：文本条目按 `sourceUri` 分组，contains 只列出 reader 实际
 *   导出的条目；不猜测未导出的子项。
 * - LUABND/BND4 脚本容器由 `scriptReferenceProvider` 负责（目录完整性语义
 *   在那边统一处理），这里不重复发布。
 *
 * contains/member_of 只证明目录成员身份，不证明资源间语义引用；FLVER→材质、
 * 材质→贴图这类连接必须等现有原生 loader 公开精确字段后才登记，缺少唯一
 * 物理目标时返回 unresolved/候选，不在这里制造。
 */
import type { Diagnostic, MsgExport, ReferenceEdge, TaeExport } from '@soulforge/shared';
export interface ContainerMemberBuildResult {
    edges: ReferenceEdge[];
    diagnostics: Diagnostic[];
    stats: {
        contains: number;
        memberOf: number;
        missingChildIdentity: number;
    };
}
export declare function buildContainerMemberEdges(taeExports: readonly TaeExport[], msgExports: readonly MsgExport[]): ContainerMemberBuildResult;
