import type { Diagnostic, EventSymbol, ReferenceEdge, TextEntrySymbol } from '@soulforge/shared';
export interface AiContextBudget {
    maxInstructions?: number;
    maxReferences?: number;
    maxUnknownArguments?: number;
    maxMarkdownChars?: number;
}
export interface EventAiContext {
    kind: 'event_explanation_context';
    eventUri: string;
    eventId: number;
    name?: string;
    summary: {
        instructionCount: number;
        highConfidenceReferences: number;
        uncertainReferences: number;
        unknownNumericArguments: number;
    };
    instructions: Array<{
        uri: string;
        index: number;
        name?: string;
        args: Array<{
            name?: string;
            value: string | number | boolean;
            role?: string;
        }>;
    }>;
    references: Array<{
        toUri: string;
        kind: ReferenceEdge['kind'];
        confidence: ReferenceEdge['confidence'];
        reason: string;
        evidence: string[];
    }>;
    evidenceMarkdown: string;
    diagnostics: Diagnostic[];
}
export interface TextAiContext {
    kind: 'text_explanation_context';
    textUri: string;
    textId: number;
    category?: string;
    text: string;
    sourceConfidence?: TextEntrySymbol['confidence'];
    sourceEvidence?: string;
    summary: {
        inboundReferences: number;
        highConfidenceReferences: number;
        uncertainReferences: number;
    };
    inboundReferences: Array<{
        fromUri: string;
        kind: ReferenceEdge['kind'];
        confidence: ReferenceEdge['confidence'];
        reason: string;
        evidence: string[];
    }>;
    evidenceMarkdown: string;
    diagnostics: Diagnostic[];
}
export declare function buildEventAiContext(event: EventSymbol, references: readonly ReferenceEdge[], budget?: AiContextBudget): EventAiContext;
export declare function buildTextAiContext(entry: TextEntrySymbol, references: readonly ReferenceEdge[], budget?: AiContextBudget): TextAiContext;
export declare function renderEventAiPrompt(context: EventAiContext): string;
export declare function renderTextAiPrompt(context: TextAiContext): string;
