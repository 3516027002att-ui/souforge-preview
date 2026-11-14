import type { ResourceKind } from '@soulforge/shared';
import type { ToolContext, ToolDescriptor } from './toolRegistry.js';
import type { ModelThinkingLevel } from '../model-services/types.js';
export type AiProvider = 'mock' | 'openai' | 'anthropic';
/**
 * 思考档位与官方 effort 表对齐（types.ts 的 ModelThinkingLevel 是唯一权威）。
 * 旧档 fast/normal/deep/extreme 只在读路径兼容，写路径只写官方值。
 */
export type AiThinkingLevel = ModelThinkingLevel;
export type AiPermissionMode = ToolContext['mode'];
export interface AiSidebarSettings {
    provider: AiProvider;
    thinking: AiThinkingLevel;
    mode: AiPermissionMode;
}
export interface AiSelectedResourceContext {
    sourceUri: string;
    relativePath: string;
    resourceKind: ResourceKind;
}
export interface AiWorkspaceContextSnapshot {
    workspaceSessionId?: string;
    selectedResource?: AiSelectedResourceContext;
    previewKind?: string;
    diagnosticsCount?: number;
    referenceStats?: {
        high: number;
        medium: number;
        low: number;
        suppressedAmbiguousNumbers?: number;
    };
    currentEventUri?: string;
}
export interface AiSidebarDraftRequest {
    settings: AiSidebarSettings;
    userPrompt: string;
    context: AiWorkspaceContextSnapshot;
    availableTools: ToolDescriptor[];
}
export interface AiToolRecommendation {
    toolName: string;
    reason: string;
    permission: string;
}
export interface AiSidebarDraft {
    provider: AiProvider;
    thinking: AiThinkingLevel;
    mode: AiPermissionMode;
    status: 'ready' | 'notConfigured';
    title: string;
    summary: string;
    contextFacts: string[];
    recommendedTools: AiToolRecommendation[];
    safetyRails: string[];
    nextActions: string[];
    promptPreview: string;
}
export declare function buildAiSidebarDraft(request: AiSidebarDraftRequest): AiSidebarDraft;
