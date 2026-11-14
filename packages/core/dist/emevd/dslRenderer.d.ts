import type { EmevdEditorDocument } from '@soulforge/shared';
import { type EmedfRegistry } from './emedfSchema.js';
/**
 * Render an editable patch template bound to one opened document revision.
 * Unknown instructions remain comments, so parsing the untouched template is
 * a deterministic no-op and never implies deletion or binary reconstruction.
 */
export declare function renderEmevdPatchDsl(document: EmevdEditorDocument, registry: EmedfRegistry): string;
export interface BoundedEmevdPatchDsl {
    text: string;
    truncated: boolean;
    totalLines: number;
    shownLines: number;
}
/**
 * Bounded template renderer (hard constraint 17): caps the line count so a
 * real corpus document (1,730 events / 33,266 instructions ≈ 70K+ lines) is
 * never transferred or materialized in one payload. Truncation happens only at
 * an event-block boundary so the visible text stays parseable; the trailing
 * marker is a comment, so compiling the truncated template is still a
 * deterministic no-op for anything the user did not edit (patch semantics only
 * express changes).
 */
export declare function renderEmevdPatchDslBounded(document: EmevdEditorDocument, registry: EmedfRegistry, templateLineLimit: number | undefined): BoundedEmevdPatchDsl;
