/**
 * MSB Region Shape Profiles and Dimension Contracts.
 *
 * Defines MapRegionShape discriminated union, shape profiles, dimension validation,
 * and mathematical scaling constraints per F02 / T03 / T04:
 * - Region transform model is position and rotation only; scale is strictly forbidden.
 * - Native MSBS IDs: point=0, sphere=2, cylinder=3, box=5. Circle=1,
 *   rectangle=4, and composite=6 remain outside dimension mutation support.
 * - Sphere requires uniform scale (r' = r * s); non-uniform scale is rejected with SHAPE_OPERATION_UNSUPPORTED.
 * - Cylinder requires uniform radial scale (scaleX === scaleZ); height scales independently.
 * - Box scales along respective axes without silent axis swapping.
 * - Unknown shape types and point have no dimension edit support and fail-closed as SHAPE_OPERATION_UNSUPPORTED.
 */
export type MapRegionShapeKind = 'point' | 'sphere' | 'cylinder' | 'box' | 'unsupported';
export interface MapRegionPointShape {
    kind: 'point';
    shapeType: 0;
}
export interface MapRegionSphereShape {
    kind: 'sphere';
    shapeType: 2;
    radius: number;
}
export interface MapRegionCylinderShape {
    kind: 'cylinder';
    shapeType: 3;
    radius: number;
    height: number;
}
export interface MapRegionBoxShape {
    kind: 'box';
    shapeType: 5;
    length: number;
    width: number;
    height: number;
}
export interface MapRegionUnsupportedShape {
    kind: 'unsupported';
    shapeType: number;
    rawShapeType?: number | undefined;
    reason?: string | undefined;
}
export type MapRegionShape = MapRegionPointShape | MapRegionSphereShape | MapRegionCylinderShape | MapRegionBoxShape | MapRegionUnsupportedShape;
export interface MsbShapeFieldDef {
    name: string;
    type: 'float32';
    offset: number;
    unit: string;
    allowZero: boolean;
}
export interface MsbShapeProfile {
    shapeType: number;
    kind: MapRegionShapeKind;
    name: string;
    writable: boolean;
    shapeDataPointerRule: string;
    fields: readonly MsbShapeFieldDef[];
    untouchedByteRule: string;
    basisHash: string;
    verifiedSamples: readonly string[];
}
export declare const POINT_SHAPE_PROFILE: MsbShapeProfile;
export declare const SPHERE_SHAPE_PROFILE: MsbShapeProfile;
export declare const CYLINDER_SHAPE_PROFILE: MsbShapeProfile;
export declare const BOX_SHAPE_PROFILE: MsbShapeProfile;
export declare const MSB_SHAPE_PROFILES: Readonly<Record<number, MsbShapeProfile>>;
export declare function getShapeProfile(shapeType: number): MsbShapeProfile | undefined;
export declare function isShapeSupported(shapeType: number): boolean;
/**
 * Validates a MapRegionShape against profile constraints.
 */
export declare function validateRegionShape(shape: MapRegionShape): {
    valid: boolean;
    code?: string;
    error?: string;
};
/**
 * Computes dimension scaling for a region shape according to strict geometric rules.
 *
 * Rules:
 * - Sphere: uniform scaling only (scaleX === scaleY === scaleZ). Non-uniform scale is rejected with SHAPE_OPERATION_UNSUPPORTED.
 * - Cylinder: radial scaling must be uniform (scaleX === scaleZ). Height (scaleY) can scale independently.
 * - Box: each dimension scales along its respective axis.
 * - Point / Unsupported: rejected with SHAPE_OPERATION_UNSUPPORTED.
 */
export declare function scaleRegionShape(current: MapRegionShape, scale: [number, number, number]): MapRegionShape;
/**
 * Rejects any attempt to set scale on a Region mutation.
 * Per F02 / T03: any of scale, scaleX, scaleY, scaleZ, scaleMultiplier, scaleDelta
 * on a Region (even null, 0, or identity) must be rejected with MSB_REGION_SCALE_UNSUPPORTED.
 */
export declare function rejectRegionScale(mutation: Record<string, unknown>): void;
