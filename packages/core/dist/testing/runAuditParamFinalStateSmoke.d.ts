/**
 * SF-06: PARAM Physical Row Identity and Final State Simulator Smoke.
 *
 * Implements unit and native smoke suites for:
 * - T13: PARAM duplicate ID disambiguation & id-only ambiguity rejection.
 * - T14: PARAM physical row delete failure injection (verifier fail-fast).
 * - T15: PARAM delete row followed by modification of subsequent row (rowIndex drift protection).
 * - T16: PARAM multiple updates to the same row in a single batch (final state post-image).
 * - T17: PARAM name modification tri-state (keep, clear, set) & verification.
 * - T18: PARAM untouched bytes preservation & bitfield isolation with BigInt bounds.
 * - Negative tests: mutating deleted rows, stale expectedDataHash, layout restrictions.
 */
export interface SnapshotRow {
    handle: string;
    id: number;
    name: string | null;
    data: Buffer;
}
export interface MutationOp {
    kind: 'update' | 'delete' | 'add';
    handle: string;
    expectedId?: number;
    expectedData?: Buffer;
    id?: number;
    name?: string | null;
    data?: Buffer;
}
export declare function simulateRows(snapshot: SnapshotRow[], mutations: MutationOp[], width: number): {
    finalRows: SnapshotRow[];
    touched: string[];
    deleted: string[];
};
export declare function verifyRows(expected: Array<{
    id: number;
    name: string | null;
    data: Buffer;
}>, actual: Array<{
    id: number;
    name: string | null;
    data: Buffer;
}>): boolean;
export declare function runParamFinalStateUnitTests(): Promise<void>;
export declare function runParamFinalStateNativeTests(): Promise<void>;
