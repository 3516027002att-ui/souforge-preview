export interface FlverValidationSample {
    id: string;
    meshCount: number;
    meshesChecked: number;
    meshesOk: number;
    decodeFailures: string[];
    emptyMeshIndices?: number[];
}
/** Empty native models have no renderable geometry to verify. */
export declare function summarizeFlverValidation<T extends FlverValidationSample>(reports: T[]): {
    ok: boolean;
    status: string;
    counts: {
        passed: number;
        failed: number;
        empty: number;
        unverified: number;
    };
    meshCounts: {
        total: number;
        verified: number;
        emptyTopology: number;
    };
    samples: (T & {
        validationStatus: "failed" | "unverified" | "empty" | "passed";
    })[];
    independentReferenceVerified: boolean;
    evidenceScope: string;
    failures: (T & {
        validationStatus: "failed" | "unverified" | "empty" | "passed";
    })[];
    message: string;
};
