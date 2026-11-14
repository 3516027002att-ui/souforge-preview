export interface SyntheticConfirmedReferenceSmokeResult {
    highEdges: number;
    mediumEdges: number;
    lowEdges: number;
    found: {
        entityHigh: boolean;
        paramHigh: boolean;
        textHigh: boolean;
        flagHigh: boolean;
        bareNumericLow: boolean;
    };
}
/**
 * v0.3 reference-graph smoke for fixture-confirmed role metadata.
 *
 * Uses BridgeResult-shaped synthetic exports (not native FromSoftware binaries)
 * to prove:
 * - role-marked instruction args become high-confidence edges after ingest;
 * - bare numeric values without role stay low-confidence fallback edges.
 *
 * This does not claim native format authority.
 */
export declare function runSyntheticConfirmedReferenceSmoke(): SyntheticConfirmedReferenceSmokeResult;
