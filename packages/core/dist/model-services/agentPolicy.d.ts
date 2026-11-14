/** Host policy and output redaction shared by the finite Agent adapter and rollout ports. */
import type { AgentRunRequest, AgentPermissionMode } from './types.js';
export { DEFAULT_APPROVAL_REQUIRED_LEVELS } from '../../../agent/src/index.mjs';
export declare function redactSecrets(text: string): string;
export declare function assertNoSecretLeak(payload: unknown, apiKey: string): void;
export declare function isToolAllowedInMode(toolName: string, mode: AgentRunRequest['permissionMode'], registeredTools: Set<string>, 
/** 工具名 → permissionLevel；生产 bridge 会透出该字段。 */
toolLevels?: ReadonlyMap<string, string>): {
    ok: true;
} | {
    ok: false;
    code: string;
    message: string;
};
export declare function extractSwitchedAgentPermissionMode(content: unknown): AgentPermissionMode | undefined;
