import type { Diagnostic } from '@soulforge/shared';
import type { FlverPreviewModel, CharacterPreviewBundle } from '@soulforge/shared';
export interface RemapResult {
    ok: boolean;
    bundle?: CharacterPreviewBundle;
    diagnostics: Diagnostic[];
}
/**
 * Resolve all body part influences against the leader bone space. This runs in
 * core/main (renderer-independent). The renderer receives one pose-owning
 * leader skeleton plus per-part follower binding metadata, so native part
 * inverse bind matrices remain available.
 *
 * Positive-weight influences with missing leader mapping fail closed.
 * Zero-weight slots are ignored.
 */
export declare function remapCharacterBundleToLeader(leaderModel: FlverPreviewModel, bodyPartModels: readonly FlverPreviewModel[]): RemapResult;
export declare function isLeaderRemappedBundle(value: unknown): boolean;
