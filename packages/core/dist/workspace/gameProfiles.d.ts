import type { ResourceKind } from '@soulforge/shared';
export type GameId = 'sekiro' | 'elden-ring' | 'dark-souls-3' | 'dark-souls-2' | 'dark-souls-1' | 'bloodborne' | 'unknown';
export interface GameProfile {
    id: GameId;
    displayName: string;
    eventExtensions: string[];
    mapExtensions: string[];
    paramExtensions: string[];
    msgExtensions: string[];
    knownResourceDirs: ResourceKind[];
    mapIdPatterns: RegExp[];
}
export interface GameInferenceResult {
    game: GameId;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
}
export declare const GAME_PROFILES: readonly GameProfile[];
export declare function getGameProfile(game: GameId): GameProfile;
export declare function inferGameFromWorkspace(relativePaths: readonly string[]): GameInferenceResult;
export declare function extractMapIdFromPath(relativePath: string, profile?: GameProfile): string | undefined;
export declare function resourceKindFromExtension(relativePath: string): ResourceKind;
