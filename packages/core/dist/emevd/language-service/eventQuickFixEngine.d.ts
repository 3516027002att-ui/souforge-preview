/**
 * Deterministic Quick Fix Engine for EMEVD DarkScript3.
 *
 * Provides safe, deterministic mechanical fixes:
 * - Typo replacement (e.g. `ShootBulelt` -> `ShootBullet`)
 * - Missing semicolon / closing parenthesis
 * - Missing argument placeholder insertion
 * - Enum member symbolic replacement
 */
import type { EmedfCompletionItem } from '../emedfCompletionCatalog.js';
import type { EmedfEnumDef } from '../emedfSchema.js';
import type { EventDiagnostic } from './eventDiagnosticsEngine.js';
export interface QuickFixAction {
    title: string;
    kind: 'quickfix';
    isPreferred?: boolean;
    from: number;
    to: number;
    replacement: string;
}
export declare function getQuickFixesAt(offset: number, diagnostics: readonly EventDiagnostic[], text: string, catalog: readonly EmedfCompletionItem[], enums?: Record<string, EmedfEnumDef>): QuickFixAction[];
