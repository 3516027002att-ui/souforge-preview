import type { EventExport } from '@soulforge/shared';
import { type EmedfRegistry } from '../emevd/emedfSchema.js';
export type EmevdParameterEvaluationStatus = 'resolved' | 'unbound' | 'ambiguous' | 'unsupported' | 'stale' | 'insufficient_evidence';
export interface EmevdParameterTrace {
    caller: string;
    callee: string;
    parameterEnvironment: Record<string, string>;
    targetInstruction: {
        uri: string;
        index: number;
        bank?: number;
        id?: number;
    };
    decodedArguments: Array<{
        name: string;
        type: string;
        value: number | boolean;
        startByte?: number;
        byteCount?: number;
    }>;
    status: EmevdParameterEvaluationStatus;
    diagnostics: string[];
}
export interface EmevdParameterEvaluationResult {
    status: EmevdParameterEvaluationStatus;
    rootUri: string;
    traces: EmevdParameterTrace[];
    cycles: string[];
    unresolved: Array<{
        caller: string;
        instructionUri: string;
        status: Exclude<EmevdParameterEvaluationStatus, 'resolved'>;
        reason: string;
    }>;
    nodesVisited: number;
    edgesExpanded: number;
    truncated: boolean;
    sourceVersions: Array<{
        sourceUri: string;
        sourceHash?: string;
        sourceRevision?: number;
    }>;
    diagnostics: string[];
}
export interface EvaluateEmevdParameterOptions {
    eventExports: readonly EventExport[];
    rootUri: string;
    registry: EmedfRegistry;
    /** Native event parameter blocks, keyed by exact EventSymbol URI. */
    parameterBytesByEventUri?: Readonly<Record<string, string>>;
    /** Optional expected source hashes; mismatch is stale, never best effort. */
    expectedSourceHashes?: Readonly<Record<string, string>>;
    maxDepth?: number;
    maxNodes?: number;
    maxExpansionEdges?: number;
}
export declare function evaluateEmevdParameters(options: EvaluateEmevdParameterOptions): EmevdParameterEvaluationResult;
