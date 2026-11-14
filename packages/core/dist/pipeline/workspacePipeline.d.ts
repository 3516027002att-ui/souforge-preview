import type { Diagnostic, IndexedFile } from '@soulforge/shared';
import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { type SemanticCacheProvider } from '../workspace/semanticFileCache.js';
export interface AnalyzeWorkspaceOptions {
    workspaceRoot: string;
    files?: readonly IndexedFile[];
    semanticCache?: SemanticCacheProvider;
    parseTextResources?: boolean;
    parseJsonFixtures?: boolean;
    inspectNativeResources?: boolean;
    exportNativeMsgResources?: boolean;
    exportNativeCandidateResources?: boolean;
    maxFilesToParse?: number;
    maxFilesToInspect?: number;
    bridgeProjectPath?: string;
    /** Optional explicit Bridge executable, primarily for release/runtime verification. */
    bridgeExecutablePath?: string;
    bridgeTimeoutMs?: number;
    /** Main-owned Sekiro installation root used for local Oodle capability. */
    oodleRuntimeRoot?: string;
    signal?: AbortSignal;
    onProgress?: (progress: AnalyzeWorkspaceProgress) => void;
    /**
     * Publish the first searchable semantic slice before the heavyweight
     * inspection pass finishes.  The callback is invoked once after the first
     * useful export, or at the end of parsing when no semantic export could be
     * accepted, so callers can distinguish "still parsing" from "no evidence".
     */
    onSemanticIndexReady?: (input: {
        index: WorkspaceIndex;
        parsedFiles: number;
        total: number;
        diagnostics: readonly Diagnostic[];
    }) => void | Promise<void>;
}
export interface AnalyzeWorkspaceProgress {
    phase: 'scan' | 'parse' | 'inspect' | 'references' | 'done';
    current: number;
    total?: number;
    message?: string;
}
export interface AnalyzeWorkspaceResult {
    index: WorkspaceIndex;
    diagnostics: Diagnostic[];
    parsedFiles: number;
    inspectedFiles: number;
    referenceStats: {
        high: number;
        medium: number;
        low: number;
        suppressedAmbiguousNumbers: number;
    };
}
/**
 * Production-shaped v0.1 analysis pipeline.
 *
 * The pipeline has two independent passes:
 * - semantic ingestion for text fixtures, JSON bridge exports, conservative native msg exports,
 *   and low-confidence native semantic candidate exports;
 * - native resource inspection through the C# bridge.
 *
 * Inspect results are evidence only. Native semantic candidates must come from a
 * resource-specific export command and stay low-confidence until fixture-reviewed.
 */
export declare function analyzeWorkspace(options: AnalyzeWorkspaceOptions): Promise<AnalyzeWorkspaceResult>;
