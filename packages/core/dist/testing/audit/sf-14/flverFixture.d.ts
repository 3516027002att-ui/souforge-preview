export interface SyntheticFlverFixture {
    bytes: Buffer;
    indices: number[];
    expectedTriangles: Array<[number, number, number]>;
    vertexCount: number;
}
export type SyntheticReferencePoseCase = 'absolute' | 'dynamic' | 'weighted' | 'invalid-binding' | 'unused-singular' | 'used-singular' | 'dynamic-cycle';
export interface SyntheticReferencePoseFixture extends SyntheticFlverFixture {
    rawPositions: number[];
    rawNormals: number[];
    expectedAbsolutePositions: number[];
    expectedAbsoluteNormals: number[];
}
/**
 * A legal Sekiro-era FLVER2 with one Float3 position, Float3 normal and
 * Float2 UV stream. The index stream is a triangle strip with two deliberate
 * degenerate connections and a primitive restart. It is intentionally larger
 * than the production 8000-triangle page cap.
 */
export declare function buildSyntheticStripFlver(emittedTriangleTarget?: number): SyntheticFlverFixture;
/** A triangle-list counterpart used to keep the cursor budget assertion honest. */
export declare function buildSyntheticTriangleListFlver(emittedTriangleTarget?: number): SyntheticFlverFixture;
/**
 * Small bone-bearing FLVER used by the map reference-pose regression.  It is
 * intentionally independent from the large SF-14 paging fixture so each
 * skinning decision is asserted against a three-vertex native stream.
 */
export declare function buildSyntheticReferencePoseFlver(testCase?: SyntheticReferencePoseCase): SyntheticReferencePoseFixture;
