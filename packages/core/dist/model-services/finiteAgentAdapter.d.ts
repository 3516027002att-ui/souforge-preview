/** Domain-neutral adapter from existing transports/rollouts to the independent finite control package. */
import { type FiniteAgentResult } from '../../../agent/src/index.mjs';
import type { AgentRunRequest, AgentRunResult } from './types.js';
export declare function runFiniteAgentAdapter(adapter: import('./types.js').ModelServiceAdapter, request: AgentRunRequest, options: {
    runId: string;
    requestId: string;
    onProtocolEvent?: (event: import('../../../agent/src/index.mjs').AgentProtocolEvent) => void;
    limits?: import('../../../agent/src/index.mjs').KernelLimits;
    pricing?: {
        inputPerMillion: number;
        outputPerMillion: number;
    };
}): Promise<{
    run: AgentRunResult;
    kernel: FiniteAgentResult;
}>;
