/**
 * TEST HARNESS ONLY — 不进 production barrel。
 *
 * 桌面生产路径使用 `ai/toolRegistry` + `ai/agentToolBridge`。
 * 本文件为 AI conformance / architecture smoke 的 typed policy 写矩阵夹具：
 * 提供 propose→stage→validate→commit 工具面与 policy gate 联测。
 * 不得从 `@soulforge/core` 公共 API 导出，也不得被 apps/desktop 引用。
 */
import type { AgentPlan, AuditLogStore, EvidencePack, PatchIR, ToolDefinition, TypedToolResult } from '@soulforge/shared';
import { MemoryResourceGraph } from '../../resource-graph/memoryResourceGraph.js';
import { type WorkspaceTransaction } from '../../transactions/workspaceTransaction.js';
export interface ScaffoldToolContext {
    workspaceId: string;
    workspaceRoot: string;
    mode: 'plan' | 'normal' | 'fullPermission';
    graph?: MemoryResourceGraph;
    transaction?: WorkspaceTransaction;
    auditLog?: AuditLogStore;
    confirmationReceiptIds?: string[];
    /**
     * 还原点落盘的基目录。
     *
     * 不传时 createRestorePoint 会退到系统临时目录，而备份是有意保留的，没有任何
     * 清理路径会删它——实测每次 patch.commit 残留一个 soulforge-backup-*。
     * 调用方（含 smoke）应指向自己的工作区子目录，让工作区释放时一并删除。
     */
    backupBaseDir?: string;
    /** Mutable bag for propose/stage/commit chain in tests. */
    state?: ScaffoldToolState;
}
export interface ScaffoldToolState {
    lastPatch?: PatchIR;
    lastTransaction?: WorkspaceTransaction;
    graph: MemoryResourceGraph;
}
type ToolHandler = (input: unknown, context: ScaffoldToolContext) => Promise<TypedToolResult> | TypedToolResult;
interface RegisteredScaffoldTool extends ToolDefinition {
    run: ToolHandler;
}
export declare class ScaffoldToolRegistry {
    private readonly tools;
    registerTool(tool: RegisteredScaffoldTool): void;
    getTool(name: string): ToolDefinition | undefined;
    listTools(): ToolDefinition[];
    executeToolThroughPolicy(name: string, input: unknown, context: ScaffoldToolContext): Promise<TypedToolResult>;
}
export declare function createScaffoldToolRegistry(): ScaffoldToolRegistry;
export declare function createMockEvidencePack(workspaceId: string, uris: string[]): EvidencePack;
export declare function createMockAgentPlan(goal: string): AgentPlan;
export declare function hashFile(path: string): Promise<string>;
export {};
