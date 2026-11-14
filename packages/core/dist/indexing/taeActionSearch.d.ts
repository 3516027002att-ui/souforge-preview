import { type TaeExport, type TaeAnimSymbol, type TaeEventSymbol } from '@soulforge/shared';
import { type TaeCompactEvent } from '../editing/taeCompactEvent.js';
export interface TaeActionSearchWindow {
    limit?: number;
    offset?: number;
    continuation?: string;
    eventLimit?: number;
    /** Compact events in fixed-size pages, first pages delivered in rank order while budgetBytes lasts (#52). */
    compact?: {
        pageSize: number;
        budgetBytes: number;
    };
    /** Keep an action only when one of its events passes this predicate (#129), and report only the events that
     *  pass it. Scoring still ranks by the query, so a field filter narrows the candidate set instead of replacing
     *  the text search — but it is a constraint, never just a ranking hint. */
    eventFilter?: (event: TaeEventSymbol) => boolean;
    /** A baseline score from the action's own identity (taeGroup, hkxName, code). Without it, "a75" matched
     *  nothing: group and hkx names never reach an event's searchable text, so a caller could not list a group. */
    actionScore?: (animation: TaeAnimSymbol) => number;
    /** Drop whole actions before ranking, e.g. keep only the tae group a weapon drives. */
    actionFilter?: (animation: TaeAnimSymbol) => boolean;
}
/** Scan cached symbols, but retain only a ranked page, never all hits/groups/events. */
export declare function searchTaeActionPage(sources: () => Iterable<TaeExport>, scoreEvent: (event: TaeEventSymbol) => number, window?: TaeActionSearchWindow): {
    continuation?: string;
    filteredActions?: number;
    matches: {
        matchedEventIndicesTruncated: boolean;
        item: {
            eventProjection?: "compact";
            events: (TaeCompactEvent | TaeEventSymbol)[];
            eventPageSize: number;
            eventsFiltered?: true;
            sourceUri: string;
            chrId: string;
            address: string;
            sourceHash: string | undefined;
            sourceRevision: number | undefined;
            readerSchemaRevision: number | undefined;
            indexedEventsComplete: boolean;
            eventsComplete: boolean;
            eventsTruncated: boolean;
            eventCount?: number;
            animId: number;
            motionAnimId?: number;
            taeEntryIndex?: number;
            taeEntryId?: number;
            taeEntryName?: string;
            taeGroup?: string;
            code: string;
            hkxName?: string;
        };
        filteredEventCount?: number;
        score: number;
        matchedEventIndices: number[];
        matchedEventCount: number;
    }[];
    total: number;
    snapshotId: string;
    retainedCandidates: number;
};
