import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { type AnalyzeWorkspaceProgress } from '../pipeline/workspacePipeline.js';
import { type NativeEditSession } from '../editing/nativeEditSession.js';
import { type ToolRegistry } from '../ai/toolRegistry.js';
import { type AgentToolBridge } from '../ai/agentToolBridge.js';
import { type CoreToolSession } from '../runtime/coreToolSession.js';
import { KnowledgeStore } from '../knowledge/knowledgeStore.js';
import type { DiagnosticEvent } from '../diagnostics/diagnosticEvent.js';
export interface LocalCliSessionOptions {
    overlayRoot: string;
    baseRoot?: string;
    game?: string;
    mode?: 'plan' | 'normal' | 'fullPermission';
    /** Explicit, one-shot rollback authorization bound to this operation ID. */
    confirmRollbackOpId?: string;
    /** Explicit, one-shot authorization to commit the proposal with this opId from the CLI. */
    confirmPatchOpId?: string;
    principal?: string;
    /** 执行一次完整语义分析；未开启时仍完成外层扫描与引用图构建。 */
    analyze?: boolean;
    /** 复用并更新受管 workspace.db 中经过 source identity 校验的语义缓存。 */
    useCache?: boolean;
    onProgress?: (progress: AnalyzeWorkspaceProgress) => void;
    onDiagnostic?: (event: DiagnosticEvent) => void;
    /**
     * 为 true 时 SQLite 打不开则整个会话失败（写入失败关闭）；
     * 为 false（只读命令）则退回内存日志并由调用方显式警告，不得静默。
     */
    requireDurableLog?: boolean;
    onFallbackWarning?: (message: string) => void;
}
export interface LocalCliSession {
    coreSession: CoreToolSession;
    editSession: NativeEditSession;
    registry: ToolRegistry;
    bridge: AgentToolBridge;
    executeTool: AgentToolBridge['executeTool'];
    workspaceIndex: WorkspaceIndex;
    durableLog: boolean;
    knowledgeStore: KnowledgeStore | null;
    dispose(): Promise<void>;
}
export interface CliRollbackAuthorization {
    readonly operationId: string;
    readonly workspaceId: string;
    readonly receipt: import('@soulforge/shared').ConfirmationReceipt;
}
type CliRollbackAuthorizationResult = {
    ok: true;
    confirmation: import('@soulforge/shared').ConfirmationReceipt;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function createCliRollbackAuthorization(input: {
    operationId: string;
    workspaceId: string;
}): CliRollbackAuthorization;
export interface CliPatchAuthorization {
    operationId: string;
    workspaceId: string;
    receipt: import('@soulforge/shared').ConfirmationReceipt;
}
/** `--confirm-patch <opId>` is the CLI approval channel for a proposal commit. */
export declare function createCliPatchAuthorization(input: {
    operationId: string;
    workspaceId: string;
}): CliPatchAuthorization;
export declare function consumeCliPatchAuthorization(authorization: CliPatchAuthorization | undefined, operationId: string, workspaceId: string): {
    ok: true;
    confirmation: import('@soulforge/shared').ConfirmationReceipt;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function consumeCliRollbackAuthorization(authorization: CliRollbackAuthorization | undefined, operationId: string, workspaceId: string): CliRollbackAuthorizationResult;
export declare function cliWorkspaceRoot(workspaceId: string): string;
export declare function openLocalCliSession(options: LocalCliSessionOptions): Promise<LocalCliSession>;
export {};
