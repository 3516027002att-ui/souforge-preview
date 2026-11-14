/**
 * Renderer-safe projections for patch impact, jobs, history and diagnostics.
 * Core-only — no DOM, no absolute path leakage into labels.
 */
import { buildPatchImpactGraph } from '../patch/patchImpactGraph.js';
export function projectJobs(tasks) {
    return tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        progressCurrent: task.progress.current,
        ...(task.progress.total !== undefined ? { progressTotal: task.progress.total } : {}),
        ...(task.progress.message ? { progressMessage: task.progress.message } : {}),
        createdAt: task.createdAt,
        ...(task.error ? { error: task.error } : {})
    }));
}
export function projectHistory(entries, options) {
    const limit = options?.limit ?? 50;
    return entries.slice(0, limit).map((entry) => ({
        opId: entry.opId,
        status: entry.status,
        mode: entry.mode,
        summary: entry.title || entry.graphSummary?.title || '（无摘要）',
        createdAt: entry.createdAt,
        fileCount: entry.fileCount ?? entry.changedPaths?.length ?? 0,
        canRollback: entry.status === 'committed'
    }));
}
export function projectPatchImpact(patch, graph) {
    const impact = buildPatchImpactGraph(patch, graph);
    return {
        patchId: impact.patchId,
        changedResources: impact.changedResources,
        directReferenceImpact: impact.directReferenceImpact,
        reverseReferenceImpact: impact.reverseReferenceImpact,
        validatorsToRun: impact.validatorsToRun,
        candidateRiskCount: impact.candidateRiskEdges.length,
        confirmedEdgeCount: impact.confirmedEdges.length,
        reindexTargets: impact.reindexTargets,
        diagnostics: impact.diagnostics.map(projectDiagnostic)
    };
}
export function projectDiagnostics(diagnostics, options) {
    const limit = options?.limit ?? 100;
    return diagnostics.slice(0, limit).map(projectDiagnostic);
}
function projectDiagnostic(d) {
    return {
        severity: d.severity,
        code: String(d.code),
        message: d.message,
        ...(d.targetUri
            ? { resourceUri: d.targetUri }
            : d.sourceUri
                ? { resourceUri: d.sourceUri }
                : {})
    };
}
//# sourceMappingURL=workbenchProjections.js.map