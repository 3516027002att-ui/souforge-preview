import type { Diagnostic } from '@soulforge/shared';
import { type MockWorkspace } from './createMockWorkspace.js';
export interface MockEvidencePipelineResult {
    workspace: MockWorkspace;
    scannedFileCount: number;
    diagnostics: Diagnostic[];
    referenceStats: {
        high: number;
        medium: number;
        low: number;
        suppressedAmbiguousNumbers: number;
    };
    eventExplanationMarkdown: string;
    patchDiff: string;
    patchValidationOk: boolean;
}
/**
 * Runs SoulForge's v0.1 core loop against synthetic data:
 *
 * scan -> parse text symbols -> ingest bridge-like JSON -> build references
 * -> collect event evidence -> create text diff -> dry-run Patch Engine validation
 */
export declare function runMockEvidencePipeline(): Promise<MockEvidencePipelineResult>;
