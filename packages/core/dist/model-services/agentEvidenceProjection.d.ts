/** Bounded bridge-produced evidence projection. It never grants native authority from model text. */
import type { ContextEvidenceSource } from './types.js';
export declare function makeToolEvidenceSource(toolName: string, content: string, meta?: Record<string, unknown>, allowStructuredClaims?: boolean): ContextEvidenceSource;
export declare function envelopeKnowledgeRefreshStatus(content: string): string | undefined;
export declare function isHealthyKnowledgeRefreshStatus(status: string): boolean;
