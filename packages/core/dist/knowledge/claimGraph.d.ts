import type { KnowledgeClaim } from './knowledgeTypes.js';
export declare function validateClaimDependencyDag(claims: readonly KnowledgeClaim[]): void;
export declare function invalidateClaimClosure(claims: readonly KnowledgeClaim[], roots: readonly string[], reason: string): KnowledgeClaim[];
