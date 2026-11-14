import type { ToolContext } from '../ai/toolRegistry.js';
import { CoreToolSession } from '../runtime/coreToolSession.js';
import type { OperationLogStore } from '../patch/operationLog.js';
import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import type { AgentSessionRunParams } from './agentSessionHost.js';
export interface AgentRunControls {
    streaming?: boolean;
    timeoutMs?: number;
    /** Whole-run deadline, distinct from the per-provider-call timeout. */
    totalTimeoutMs?: number;
    maxCost?: number;
    pricing?: {
        inputPerMillion: number;
        outputPerMillion: number;
    };
    maxSteps?: number;
    maxTotalOutputTokens?: number;
    autoCompactTokenLimit?: number;
    retryMaxAttempts?: number;
    useRagSearch?: boolean;
    ragSearchMaxHits?: number;
    useContextBroker?: boolean;
    contextMaxBytes?: number;
}
export interface AgentHostComposition {
    controls?: AgentRunControls;
    defaultTimeoutMs?: number;
    defaultTotalTimeoutMs?: number;
    maxStepsCeiling?: number;
    autoCompaction?: boolean;
    contextWindowTokens?: number;
    sampling?: AgentSessionRunParams['sampling'];
    ragSearch?: AgentSessionRunParams['ragSearch'];
}
type RunParams = Omit<AgentSessionRunParams, 'tools' | 'executeTool'>;
/** Shared execution configuration; permission, credentials and prompts remain trusted host inputs. */
export declare function composeAgentSessionOptions(params: RunParams, host?: AgentHostComposition): RunParams;
/** Hold stable policy only; current resource/index state comes from the host provider. */
export declare function createAgentBridgeBaseContext(mode: ToolContext['mode']): ToolContext;
export declare function createAgentCoreToolSession(input: {
    principal: string;
    workspaceId: string;
    workspaceSession: WorkspaceSession;
    workspaceIndex?: WorkspaceIndex;
    operationLog: OperationLogStore;
    modeCeiling: ToolContext['mode'];
    storage: {
        backupBaseDir: string;
        recoveryDir: string;
        stagingRoot?: string;
    };
}): CoreToolSession;
/** The asynchronous storage port cannot attach a replacement workspace to the run. */
export declare function openAgentCoreToolSession(input: {
    principal: string;
    workspaceSession: WorkspaceSession;
    workspaceIndex?: WorkspaceIndex;
    modeCeiling: ToolContext['mode'];
    storage: {
        backupBaseDir: string;
        recoveryDir: string;
        stagingRoot?: string;
    };
    getWorkspaceSession(): WorkspaceSession | null | undefined;
    getOperationLog(session: WorkspaceSession): Promise<OperationLogStore>;
}): Promise<CoreToolSession>;
export declare function wrapAgentToolContextRefreshCallbacks(context: ToolContext, onRefreshComplete: () => void, isOwnerCurrent?: () => boolean): ToolContext;
export declare function createAgentToolContextProvider(ports: {
    coreSession?: CoreToolSession;
    workspaceSession?: WorkspaceSession;
    getWorkspaceSession(): WorkspaceSession | null | undefined;
    getWorkspaceIndex(): WorkspaceIndex | null | undefined;
    getToolContext(): ToolContext;
}): () => ToolContext;
/** Existing bounded automatic lookup, with the run's workspace identity held across awaits. */
export declare function createAgentRagSearch(ports: {
    workspaceSession: WorkspaceSession;
    getWorkspaceSession(): WorkspaceSession | null | undefined;
    signal: AbortSignal;
    waitForIndexing(signal: AbortSignal): Promise<unknown>;
    retrieve(query: string, signal: AbortSignal): ReturnType<NonNullable<AgentSessionRunParams['ragSearch']>['retrieve']>;
}): NonNullable<AgentSessionRunParams['ragSearch']>;
export {};
