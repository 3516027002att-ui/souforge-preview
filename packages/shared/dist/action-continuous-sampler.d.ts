/**
 * Authoritative Client-Side Continuous Animation Sampler.
 *
 * Evaluates continuous-time skeletal animation poses (Spline and Interleaved)
 * and projects them to FLVER bone index order.
 *
 * Clean-room implementation matching C# Bridge ActionContinuousSampler.
 */
export interface BoneTransformData {
    translation: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
}
export interface SplineCurveData {
    degree: number;
    knots: number[];
    controlPoints: number[];
}
export interface SplineQuatCurveData {
    degree: number;
    knots: number[];
    controlPoints: Array<[number, number, number, number]>;
}
export interface TransformSplineTrackData {
    staticPosition: [number, number, number];
    staticRotation: [number, number, number, number];
    staticScale: [number, number, number];
    /** Raw decoder diagnostics; the sampler does not use these masks. */
    positionStaticMask?: number | undefined;
    positionSplineMask?: number | undefined;
    rotationHasStatic?: boolean | undefined;
    rotationHasSpline?: boolean | undefined;
    scaleStaticMask?: number | undefined;
    scaleSplineMask?: number | undefined;
    positionQuantizationType?: number | undefined;
    rotationQuantizationType?: number | undefined;
    scaleQuantizationType?: number | undefined;
    positionX?: SplineCurveData | undefined;
    positionY?: SplineCurveData | undefined;
    positionZ?: SplineCurveData | undefined;
    rotation?: SplineQuatCurveData | undefined;
    scaleX?: SplineCurveData | undefined;
    scaleY?: SplineCurveData | undefined;
    scaleZ?: SplineCurveData | undefined;
}
export interface SplineBlockData {
    tracks: TransformSplineTrackData[];
}
export interface TaeAnimationClipData {
    animId: number;
    motionAnimId: number;
    sourceContainer?: string | undefined;
    sourceHash?: string | undefined;
    animationContainerHash?: string | undefined;
    animationType: 'SplineCompressed' | 'Interleaved' | string;
    /** False means the clip payload contains local skeletal animation only. */
    rootMotionSupported?: boolean | undefined;
    duration: number;
    frameCount: number;
    frameDuration: number;
    transformTrackCount: number;
    hkxBoneCount: number;
    hkxBoneNames: string[];
    /** Parent indices in the HKX skeleton namespace; required for duplicate-name-safe retargeting. */
    hkxParentIndices: number[];
    hkxReferencePose: BoneTransformData[];
    trackToHkxBone: number[];
    hkxToFlverBoneMap?: number[] | undefined;
    binding?: {
        originalSkeletonName: string;
        transformTrackToBoneIndices: number[];
    } | undefined;
    skeleton?: {
        name: string;
    } | undefined;
    interleavedTransforms?: BoneTransformData[] | undefined;
    splineBlocks?: SplineBlockData[] | undefined;
    maxFramesPerBlock?: number | undefined;
    blockDuration?: number | undefined;
    blockInverseDuration?: number | undefined;
    splineRawPayloadBase64?: string | undefined;
    splineMaskAndQuantizationSize?: number | undefined;
    splineNumBlocks?: number | undefined;
    splineBlockOffsets?: number[] | undefined;
    splineFloatBlockOffsets?: number[] | undefined;
    splineTransformOffsets?: number[] | undefined;
    splineFloatOffsets?: number[] | undefined;
}
export declare class ActionContinuousSampler {
    private clip;
    constructor(clip: TaeAnimationClipData);
    get duration(): number;
    get frameCount(): number;
    get frameDuration(): number;
    /**
     * Samples the continuous pose in HKX bone order.
     */
    sampleHkxPose(timeSeconds: number, loop?: boolean): BoneTransformData[];
    /**
     * Samples the continuous pose and remaps to FLVER bone index order.
     */
    sampleFlverPose(timeSeconds: number, flverBoneCount: number, flverReferencePose?: BoneTransformData[] | undefined, loop?: boolean, flverParentIndices?: readonly number[] | undefined): BoneTransformData[];
    private sampleInterleaved;
    private sampleSpline;
}
export declare function evaluateBSpline(curve: SplineCurveData, t: number): number;
export declare function evaluateBSplineQuat(curve: SplineQuatCurveData, t: number): [number, number, number, number];
/**
 * Converts native FLVER Euler fields (radians) to a Three.js quaternion.
 *
 * SoulsFormats' FLVER bone local matrix is the row-vector product
 * `Scale * RotationX * RotationZ * RotationY * Translation`.  Transposing
 * that matrix for Three.js column-vector transforms gives
 * `Translation * RotationY * RotationZ * RotationX * Scale`, so the rotation
 * quaternion must be composed as `qy * qz * qx`.  This is intentionally not
 * Three.js' `Euler(..., 'XZY')` composition (`qx * qz * qy`).
 */
export declare function eulerXYZToQuaternion(euler: [number, number, number] | readonly [number, number, number]): [number, number, number, number];
export declare const flverEulerToQuaternion: typeof eulerXYZToQuaternion;
