import type { NormalizedReferenceQuery, ReferencePageRecord } from '@soulforge/shared';
import type { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import type { NativeEditSession } from '../editing/nativeEditSession.js';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
import type { DiagnosticEvent } from '../diagnostics/diagnosticEvent.js';
import { type NativeReferenceDomainProgress } from './nativeReferenceContent.js';
import type { ReferenceCursorStore } from './referenceCursorStore.js';
/** Prepare bounded, read-only source content before locking a relation page. */
export declare function prepareReferenceContentSearch(options: {
    index: WorkspaceIndex;
    edit: NativeEditSession;
    input: NormalizedReferenceQuery;
    store: ReferenceCursorStore;
    registry?: EmedfRegistry;
    signal?: AbortSignal;
    targetUri?: string;
    prioritySourceUris?: string[];
    /** Restrict the scan to these domains (same-domain queries); omitted = all. */
    domains?: readonly ('event' | 'param' | 'script')[];
    /** Let a same-domain query finish its own domain in one call. */
    maxSourcesByDomain?: Partial<Record<'event' | 'param' | 'script', number>>;
    persist?: (sourceUris: string[]) => Promise<void>;
    onDiagnostic?: (event: DiagnosticEvent) => void;
}): Promise<{
    scan: ReferencePageRecord['scan'];
    diagnostics: ReferencePageRecord['diagnostics'];
    channel: Record<'event' | 'param' | 'script', NativeReferenceDomainProgress>;
}>;
