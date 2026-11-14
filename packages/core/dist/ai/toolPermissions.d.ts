import type { AiToolPermissionLevel, PatchMode } from '@soulforge/shared';
/**
 * Ordered AI tool permission ladder.
 * Higher ranks include lower capabilities after mode policy checks.
 */
export declare const AI_TOOL_PERMISSION_ORDER: readonly AiToolPermissionLevel[];
/**
 * Map UI / session modes to the maximum tool permission allowed by default.
 * Full-permission still cannot bypass Patch Engine; it only raises the tool ceiling.
 */
export declare function maxPermissionForMode(mode: PatchMode | 'plan' | 'normal' | 'fullPermission'): AiToolPermissionLevel;
export interface AiToolPermissionDecision {
    allowed: boolean;
    required: AiToolPermissionLevel;
    mode: PatchMode | 'plan' | 'normal' | 'fullPermission';
    ceiling: AiToolPermissionLevel;
}
/**
 * Single runtime permission predicate shared by ToolRegistry and AgentLoop.
 * Callers should use the returned ceiling when explaining a denial so the
 * model receives the same policy facts that decided execution.
 */
export declare function decideAiToolPermission(required: AiToolPermissionLevel, mode: PatchMode | 'plan' | 'normal' | 'fullPermission'): AiToolPermissionDecision;
export declare function isAiToolPermissionAllowed(required: AiToolPermissionLevel, mode: PatchMode | 'plan' | 'normal' | 'fullPermission'): boolean;
/**
 * Backward-compatible bridge from the earlier read/plan/write tool tags.
 */
export declare function legacyPermissionToLevel(permission: 'read' | 'plan' | 'write'): AiToolPermissionLevel;
export declare function describePermissionLevel(level: AiToolPermissionLevel): string;
