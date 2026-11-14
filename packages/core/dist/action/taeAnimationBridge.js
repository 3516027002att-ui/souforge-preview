/**
 * Authoritative TAE Animation Clip & Pose Bridge Helper.
 *
 * Connects renderer / desktop to Bridge for loading real HKX animations and sampling poses.
 */
import { runBridge } from '../bridge/runBridge.js';
export async function loadTaeAnimationClip(options) {
    return runBridge({
        command: 'read-tae-animation-clip',
        filePath: options.filePath,
        commandOptions: {
            animId: options.animId,
            ...(options.taeEntryIndex !== undefined ? { taeEntryIndex: options.taeEntryIndex } : {}),
            ...(options.taeEntryId !== undefined ? { taeEntryId: options.taeEntryId } : {}),
            ...(options.taeEntryName !== undefined ? { taeEntryName: options.taeEntryName } : {}),
            ...(options.taeGroup !== undefined ? { taeGroup: options.taeGroup } : {}),
            ...(options.animationContainerPath ? { animationContainerPath: options.animationContainerPath } : {}),
            ...(options.skeletonContainerPath ? { skeletonContainerPath: options.skeletonContainerPath } : {}),
            ...(options.flverBoneNames?.length ? { flverBoneNames: options.flverBoneNames } : {})
        },
        ...(options.oodleRuntimeRoot !== undefined ? { oodleRuntimeRoot: options.oodleRuntimeRoot } : {}),
        ...(options.allowedRoots !== undefined ? { allowedRoots: options.allowedRoots } : {}),
        timeoutMs: options.timeoutMs ?? 20_000
    });
}
export async function sampleTaeAnimationPose(options) {
    return runBridge({
        command: 'sample-tae-animation-pose',
        filePath: options.filePath,
        commandOptions: {
            animId: options.animId,
            timeSeconds: options.timeSeconds,
            loop: options.loop ?? true,
            ...(options.taeEntryIndex !== undefined ? { taeEntryIndex: options.taeEntryIndex } : {}),
            ...(options.taeEntryId !== undefined ? { taeEntryId: options.taeEntryId } : {}),
            ...(options.taeEntryName !== undefined ? { taeEntryName: options.taeEntryName } : {}),
            ...(options.taeGroup !== undefined ? { taeGroup: options.taeGroup } : {}),
            ...(options.animationContainerPath ? { animationContainerPath: options.animationContainerPath } : {}),
            ...(options.skeletonContainerPath ? { skeletonContainerPath: options.skeletonContainerPath } : {}),
            ...(options.flverBoneNames?.length ? { flverBoneNames: options.flverBoneNames } : {}),
            ...(options.flverReferencePose?.length ? { flverReferencePose: options.flverReferencePose } : {})
        },
        ...(options.oodleRuntimeRoot !== undefined ? { oodleRuntimeRoot: options.oodleRuntimeRoot } : {}),
        ...(options.allowedRoots !== undefined ? { allowedRoots: options.allowedRoots } : {}),
        timeoutMs: options.timeoutMs ?? 20_000
    });
}
//# sourceMappingURL=taeAnimationBridge.js.map