/**
 * AI tool permission model (architecture forks #126–#129).
 * Tools never write files directly; commit/rollback go through policy + transaction.
 */
export const AI_TOOL_PERMISSION_LEVELS = [
    'read',
    'analyze',
    'propose',
    'stage',
    'validate',
    'commit',
    'rollback'
];
//# sourceMappingURL=ai-tools.js.map