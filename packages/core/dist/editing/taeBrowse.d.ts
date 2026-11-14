import type { Diagnostic, TaeEntryWire } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
import type { TaeActionSnapshot, TaeEditFailure, TaeEventSnapshot } from './taeEdit.js';
/** Match the existing Desktop native animation page, not a new event quota. */
export declare const TAE_BROWSE_ANIMATION_PAGE_SIZE = 64;
export interface TaeBrowseNativePage {
    ok: true;
    chrId: string;
    readerSchemaRevision: number;
    sourceHash?: string;
    outerFileHash?: string;
    containerSourceHash?: string;
    animationCount?: number;
    totalEventCount?: number;
    animationsTruncated: boolean;
    taeEntryCount?: number;
    taeEntries?: TaeEntryWire[];
    actions: Array<TaeActionSnapshot & {
        eventsTruncated?: boolean;
    }>;
    events: TaeEventSnapshot[];
    diagnostics: Diagnostic[];
}
export interface TaeBrowseFailure {
    ok: false;
    error: TaeEditFailure;
    diagnostics: Diagnostic[];
}
export interface TaeBrowseAction extends TaeActionSnapshot {
    eventsComplete: boolean;
    eventsTruncated: boolean;
    pagination: {
        totalCount: number;
        returnedCount: number;
        offset: number;
        hasMore: boolean;
        nextRead?: {
            tool: 'read_tae_events';
            args: {
                file: string;
                addresses: string[];
                offset: number;
                pageSize: number;
                expectedSourceHash: string;
                expectedReaderSchemaRevision: number;
            };
        };
    };
}
/**
 * A preview must answer "is this animation worth reading?" without a second call.
 *
 * The event window itself stays byte-bounded (a c0000 event carries ~20 decoded
 * fields, so two events already fill the old page), which left a caller with one
 * event count per action and no way to see what the events were. This is the cheap
 * projection of the same native page: the page's event-type histogram, the first
 * events with their timing, and every action of the page with the type ids it
 * uses — all derived from the page already in memory, no extra Bridge read.
 */
export interface TaeBrowsePreviewEvent {
    eventIndex: number;
    address?: string;
    eventTypeId: number;
    typeName?: string;
    startTime: number;
    endTime: number;
}
export interface TaeBrowsePreviewAction {
    code: string;
    address: string;
    eventCount: number;
    /** Type ids present in this action, ascending; the page histogram maps them to names. */
    eventTypeIds: number[];
}
export interface TaeBrowsePreview {
    /** Actions on this native page (a page is TAE_ANIMATION_PAGE_SIZE animations). */
    animationCount: number;
    eventCount: number;
    /** False when the native page itself truncated an action's events. */
    eventCountComplete: boolean;
    eventTypeCounts: Array<{
        eventTypeId: number;
        typeName?: string;
        count: number;
    }>;
    eventTypesTruncated?: true;
    firstEvents: TaeBrowsePreviewEvent[];
    actions: TaeBrowsePreviewAction[];
    actionsTruncated?: true;
    remainingActions?: number;
}
export type TaeBrowseResult = TaeBrowseFailure | Omit<TaeBrowseNativePage, 'animationsTruncated' | 'actions'> & {
    filePath: string;
    status: 'partial' | 'complete';
    eventsTruncated: boolean;
    actions: TaeBrowseAction[];
    preview: TaeBrowsePreview;
    pagination: {
        returnedCount: number;
        totalCount: null;
        offset: number;
        hasMore: boolean;
        nextCursor: string | null;
        totalPages: null;
    };
    nativePagination: {
        animationPage: number;
        animationPageSize: number;
        returnedCount: number;
        totalCount: number | null;
        hasMore: boolean;
    };
};
export interface TaeBrowseInput {
    edit: NativeEditSession;
    filePath: string;
    cursor?: string;
    offset?: number;
    pageSize?: number;
    expectedSourceHash?: string;
    expectedReaderSchemaRevision?: number;
    /** The facade owns native parsing, identity validation and projection. */
    loadPage: (animationPage: number, animationPageSize: number) => Promise<TaeBrowseNativePage | TaeBrowseFailure>;
}
/**
 * Browse bounded native animation previews. Each shared session retains one
 * immutable native page; only following its boundary cursor loads the next.
 * This does not hydrate event tails or build an all-document event array.
 */
export declare function readTaeBrowse(input: TaeBrowseInput): Promise<TaeBrowseResult>;
