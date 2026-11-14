/**
 * Deterministic Ranking Completion Engine for EMEVD DarkScript3.
 *
 * Provides snippet skeletons, enum argument suggestions, event parameters (X0_4),
 * event ID lookups, and deterministic ranking:
 * 1. Exact match
 * 2. Prefix match
 * 3. CamelCase / token match (e.g. `ShtBul` -> `ShootBullet`)
 * 4. Subsequence / fuzzy match
 */
import type { EmedfCompletionItem } from '../emedfCompletionCatalog.js';
import type { EmedfEnumDef } from '../emedfSchema.js';
import type { EventCursorContext } from './eventCursorContext.js';
export type CompletionItemKind = 'function' | 'enum' | 'enum-member' | 'parameter' | 'event-id' | 'keyword' | 'constant' | 'value';
export interface EventCompletionCandidate {
    label: string;
    kind: CompletionItemKind;
    detail?: string;
    info?: string;
    insertText?: string;
    snippet?: string;
    boost?: number;
    replacementSpan?: {
        from: number;
        to: number;
    };
}
export interface CompletionQueryContext {
    context: EventCursorContext;
    catalog: readonly EmedfCompletionItem[];
    enums?: Record<string, EmedfEnumDef>;
    knownEventIds?: Array<{
        eventId: number;
        title?: string;
        doc?: string;
    }>;
    recentSelections?: readonly string[];
}
/**
 * Match score computation:
 * Returns score > 0 if pattern matches target, otherwise 0.
 */
export declare function scoreMatch(pattern: string, target: string): number;
/**
 * Build a snippet skeleton for an instruction call.
 * Format: `Name(${1:arg0}, ${2:arg1})`
 */
export declare function buildInstructionSnippet(item: EmedfCompletionItem): string;
/**
 * Main completion query entrypoint.
 */
export declare function getCompletions(query: CompletionQueryContext): EventCompletionCandidate[];
