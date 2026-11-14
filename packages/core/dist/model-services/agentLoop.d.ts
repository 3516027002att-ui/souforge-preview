import type { AgentRunRequest, AgentRunResult, ModelServiceAdapter } from './types.js';
export { redactSecrets, assertNoSecretLeak, isToolAllowedInMode, DEFAULT_APPROVAL_REQUIRED_LEVELS, extractSwitchedAgentPermissionMode } from './agentPolicy.js';
export declare function runAgentToolLoop(adapter: ModelServiceAdapter, request: AgentRunRequest): Promise<AgentRunResult>;
