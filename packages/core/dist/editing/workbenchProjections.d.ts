/**
 * Renderer-safe projections for patch impact, jobs, history and diagnostics.
 * Core-only — no DOM, no absolute path leakage into labels.
 */
import type { PatchIR, PatchHistoryEntry, StructuredDiagnostic } from '@soulforge/shared';
import type { QueuedTask, TaskStatus } from '../jobs/taskQueue.js';
import type { MemoryResourceGraph } from '../resource-graph/memoryResourceGraph.js';
export interface JobListItem {
    id: string;
    title: string;
    status: TaskStatus;
    progressCurrent: number;
    progressTotal?: number;
    progressMessage?: string;
    createdAt: number;
    error?: string;
}
export interface HistoryListItem {
    opId: string;
    status: string;
    mode: string;
    summary: string;
    createdAt: string;
    fileCount: number;
    canRollback: boolean;
}
export interface DiagnosticsListItem {
    severity: string;
    code: string;
    message: string;
    resourceUri?: string;
}
export interface PatchImpactView {
    patchId: string;
    changedResources: string[];
    directReferenceImpact: string[];
    reverseReferenceImpact: string[];
    validatorsToRun: string[];
    candidateRiskCount: number;
    confirmedEdgeCount: number;
    reindexTargets: string[];
    diagnostics: DiagnosticsListItem[];
}
export declare function projectJobs(tasks: Array<QueuedTask<unknown>>): JobListItem[];
export declare function projectHistory(entries: PatchHistoryEntry[], options?: {
    limit?: number;
}): HistoryListItem[];
export declare function projectPatchImpact(patch: PatchIR, graph?: MemoryResourceGraph): PatchImpactView;
export declare function projectDiagnostics(diagnostics: StructuredDiagnostic[], options?: {
    limit?: number;
}): DiagnosticsListItem[];
