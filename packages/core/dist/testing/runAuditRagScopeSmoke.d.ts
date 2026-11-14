interface SmokeSummary {
    readonly ok: true;
    readonly taskId: 'SF-18';
    readonly cases: number;
    readonly productionExports: readonly string[];
}
export declare function runAuditRagScopeSmoke(): SmokeSummary;
export {};
