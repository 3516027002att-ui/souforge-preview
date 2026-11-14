/**
 * TEST HARNESS ONLY — scaffold 写矩阵用 policy gate。
 * 生产路径权限判定见 `ai/toolPermissions.ts`。
 */
import type { PolicyDecision, PolicyGateContext, ToolPermission } from '@soulforge/shared';
export declare function evaluatePolicyGate(context: PolicyGateContext): PolicyDecision;
export declare function maxPermissionFromMode(mode: PolicyGateContext['mode']): ToolPermission;
export declare function isPermissionAtLeast(actual: ToolPermission, required: ToolPermission): boolean;
export declare function listPermissionLadder(): readonly ToolPermission[];
