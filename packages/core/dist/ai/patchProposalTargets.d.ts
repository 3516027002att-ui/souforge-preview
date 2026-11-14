import type { PatchProposal } from '@soulforge/shared';
/**
 * A tool-shaped change (`{ tool, args }`) carries no `targetUri`/`targetPath`, so the Patch Engine
 * and the graph IR see nothing to rewrite: validation answered `PATCH_OP_MISSING_TARGET` and the
 * graph drew a node named `file:undefined`, both while reporting a normal result.
 *
 * Resolve the target from the nested arguments so a proposal an agent can actually produce is also
 * a proposal the rest of the pipeline can reason about. Anything still unresolved is a hard error:
 * drawing or validating "undefined" is worse than refusing.
 */
export type ProposalTargetsResult = {
    ok: true;
    proposal: PatchProposal;
} | {
    ok: false;
    index: number;
    message: string;
};
export declare function normalizeProposalTargets(proposal: PatchProposal): ProposalTargetsResult;
