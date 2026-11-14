import type { EventSymbol, ReferenceEdge } from '@soulforge/shared';
export interface EventEvidenceReport {
    eventUri: string;
    eventId: number;
    name?: string;
    confirmed: EvidenceLine[];
    possible: EvidenceLine[];
    unknownArguments: UnknownArgument[];
    diagnostics: string[];
}
export interface EvidenceLine {
    targetUri: string;
    kind: ReferenceEdge['kind'];
    confidence: ReferenceEdge['confidence'];
    reason: string;
    evidence: string[];
}
export interface UnknownArgument {
    instructionUri: string;
    instructionName?: string;
    argName?: string;
    value: string | number | boolean;
}
export declare function collectEventEvidence(event: EventSymbol, edges: ReferenceEdge[]): EventEvidenceReport;
export declare function renderEventEvidenceMarkdown(report: EventEvidenceReport): string;
