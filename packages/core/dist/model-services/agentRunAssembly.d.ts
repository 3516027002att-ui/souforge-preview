import type { AgentToolBridge } from '../ai/agentToolBridge.js';
import type { CoreToolSession } from '../runtime/coreToolSession.js';
import { runAgentSession, type AgentSessionRunParams } from './agentSessionHost.js';
import { type AgentHostComposition } from './agentHostComposition.js';
/** Desktop, CLI and evaluators use one assembly surface over the same domain bridge. */
export declare function createAgentRunAssembly(bridge: AgentToolBridge, options?: {
    sessionRunner?: typeof runAgentSession;
    coreSession?: CoreToolSession;
    composition?: AgentHostComposition;
}): {
    waitForHostOperations(): Promise<void>;
    getHostRequestStatuses(): ({
        transaction?: {
            operations: {
                opId: string;
                state: import("../index.js").TransactionOutcomeState;
            }[];
            opIds?: string[];
            opId?: string;
            state: import("../index.js").TransactionOutcomeState;
        };
        requestState?: import("../cli/localSessionHost.js").SessionRequestState;
        opIds?: string[];
        id: string;
        state: import("../cli/localSessionHost.js").SessionRequestState;
    } | undefined)[];
    resolvePriorCallOutcome(sessionId: string, callId: string): Promise<{
        transaction?: {
            operations: {
                opId: string;
                state: import("../index.js").TransactionOutcomeState;
            }[];
            opIds?: string[];
            opId?: string;
            state: import("../index.js").TransactionOutcomeState;
        };
        requestState?: import("../cli/localSessionHost.js").SessionRequestState;
        opIds?: string[];
        id: string;
        state: import("../cli/localSessionHost.js").SessionRequestState;
    } | undefined>;
    run(params: Omit<AgentSessionRunParams, "tools" | "executeTool">): Promise<import("./agentSessionHost.js").AgentSessionRunResult>;
};
