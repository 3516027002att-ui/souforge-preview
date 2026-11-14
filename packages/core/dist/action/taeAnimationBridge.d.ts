/**
 * Authoritative TAE Animation Clip & Pose Bridge Helper.
 *
 * Connects renderer / desktop to Bridge for loading real HKX animations and sampling poses.
 */
import type { BridgeResult, TaeAnimationClipData, BoneTransformData } from '@soulforge/shared';
export interface LoadTaeAnimationClipOptions {
    filePath: string;
    animId: number;
    /** Explicit TAE child identity; animId alone is not unique in an ANIBND. */
    taeEntryIndex?: number | undefined;
    taeEntryId?: number | undefined;
    taeEntryName?: string | undefined;
    taeGroup?: string | undefined;
    /** Explicit ANIBND that contains the HKX entry for this TAE motion. */
    animationContainerPath?: string | undefined;
    /** Explicit ANIBND that contains skeleton.hkx when it is not in the animation container. */
    skeletonContainerPath?: string | undefined;
    flverBoneNames?: string[] | undefined;
    oodleRuntimeRoot?: string | undefined;
    allowedRoots?: string[] | undefined;
    timeoutMs?: number | undefined;
}
export interface SampleTaeAnimationPoseOptions {
    filePath: string;
    animId: number;
    timeSeconds: number;
    /** Explicit TAE child identity; animId alone is not unique in an ANIBND. */
    taeEntryIndex?: number | undefined;
    taeEntryId?: number | undefined;
    taeEntryName?: string | undefined;
    taeGroup?: string | undefined;
    animationContainerPath?: string | undefined;
    skeletonContainerPath?: string | undefined;
    loop?: boolean | undefined;
    flverBoneNames?: string[] | undefined;
    flverReferencePose?: BoneTransformData[] | undefined;
    oodleRuntimeRoot?: string | undefined;
    allowedRoots?: string[] | undefined;
    timeoutMs?: number | undefined;
}
export interface SampledPoseResponse {
    animId: number;
    motionAnimId: number;
    timeSeconds: number;
    duration: number;
    boneCount: number;
    sampledPose: BoneTransformData[];
    /** False means the response contains local skeletal pose only. */
    rootMotionSupported: false;
}
export declare function loadTaeAnimationClip(options: LoadTaeAnimationClipOptions): Promise<BridgeResult<TaeAnimationClipData>>;
export declare function sampleTaeAnimationPose(options: SampleTaeAnimationPoseOptions): Promise<BridgeResult<SampledPoseResponse>>;
