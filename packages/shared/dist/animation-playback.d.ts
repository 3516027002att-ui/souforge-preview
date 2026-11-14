/**
 * Authoritative Animation Playback Clock and Timeline Block State Models.
 *
 * Ensures 3D Viewport animation preview, Timeline playhead, and Inspector
 * share a single authoritative playback clock and timeline block mapping.
 */
import { type TaeDiagnostic, type TaeTemplateFieldValue, type TaeTimelineEventRow } from './animation-editor.js';
export declare const DEFAULT_FRAME_RATE = 30;
export interface AnimationPlaybackState {
    isPlaying: boolean;
    currentTime: number;
    currentFrame: number;
    duration: number;
    totalFrames: number;
    fps: number;
    playbackRate: number;
    loop: boolean;
}
export type PlaybackStateListener = (state: AnimationPlaybackState) => void;
/**
 * Authoritative animation playback clock controller.
 */
export declare class AnimationPlaybackClock {
    private state;
    private listeners;
    constructor(options?: {
        duration?: number | undefined;
        fps?: number | undefined;
        loop?: boolean | undefined;
        playbackRate?: number | undefined;
    });
    getState(): Readonly<AnimationPlaybackState>;
    subscribe(listener: PlaybackStateListener): () => void;
    private notify;
    play(): void;
    pause(): void;
    togglePlay(): void;
    stop(): void;
    seek(seconds: number): void;
    seekFrame(frame: number): void;
    stepFrame(deltaFrames: number): void;
    setPlaybackRate(rate: number): void;
    setLoop(loop: boolean): void;
    setDuration(duration: number): void;
    tick(deltaSeconds: number): void;
}
/**
 * Structured Timeline Event Block for visual representation and interaction.
 */
export interface TaeTimelineBlock {
    id: string;
    animId: number;
    eventIndex: number;
    eventTypeId: number;
    startTime: number;
    endTime: number;
    startFrame: number;
    endFrame: number;
    durationFrames: number;
    trackIndex: number;
    parameterDecoded?: boolean | undefined;
    templateFields?: TaeTemplateFieldValue[] | undefined;
    parameterBytesHex?: string | undefined;
    hasError: boolean;
    errorMessage: string | null;
}
export interface TaeTimelineTrack {
    trackIndex: number;
    blocks: TaeTimelineBlock[];
}
/**
 * Packs flat TAE events into non-overlapping timeline tracks and maps validation errors.
 */
export declare function buildTaeTimelineTracks(events: readonly TaeTimelineEventRow[], diagnostics?: readonly TaeDiagnostic[] | undefined, options?: {
    fps?: number | undefined;
} | undefined): TaeTimelineTrack[];
/**
 * Authoritative Bone Transform structure decoded from Havok HKX animation.
 */
export interface AuthoritativeBoneTransform {
    p: [number, number, number];
    q: [number, number, number, number];
    s: [number, number, number];
}
/**
 * Authoritative Animation Clip payload returned from Bridge / HKX decoder.
 */
export interface AuthoritativeAnimationClip {
    animId: number;
    animName: string;
    sourceFile: string;
    duration: number;
    frameCount: number;
    frameDuration: number;
    trackCount: number;
    boneCount: number;
    poses: AuthoritativeBoneTransform[][];
}
/**
 * Deterministically samples bone poses at a given continuous time.
 */
export declare function sampleAuthoritativePose(clip: AuthoritativeAnimationClip, time: number, loop?: boolean): AuthoritativeBoneTransform[] | null;
