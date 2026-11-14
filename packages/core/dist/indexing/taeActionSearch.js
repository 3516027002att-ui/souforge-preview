import { createHash } from 'node:crypto';
import { formatActionAddress } from '@soulforge/shared';
import { compactTaeEvent } from '../editing/taeCompactEvent.js';
const compare = (a, b) => b.score - a.score || a.ordinal - b.ordinal;
function retain(items, item, limit, compareItems) {
    if (items.length === limit && compareItems(item, items[items.length - 1]) >= 0)
        return;
    const position = items.findIndex(current => compareItems(item, current) < 0);
    items.splice(position < 0 ? items.length : position, 0, item);
    if (items.length > limit)
        items.pop();
}
const invalid = () => { throw Object.assign(new Error('动作搜索窗口或续页位置无效。'), { code: 'INVALID_SEARCH_WINDOW' }); };
/** Scan cached symbols, but retain only a ranked page, never all hits/groups/events. */
export function searchTaeActionPage(sources, scoreEvent, window = {}) {
    const limit = window.limit ?? 6, eventLimit = window.eventLimit ?? 16, offset = window.offset ?? 0, compact = window.compact;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128 || !Number.isSafeInteger(eventLimit) || eventLimit < 0 || eventLimit > 128
        || !Number.isSafeInteger(offset) || offset < 0)
        invalid();
    if (compact && (!Number.isSafeInteger(compact.pageSize) || compact.pageSize < 1 || compact.pageSize > 128
        || !Number.isSafeInteger(compact.budgetBytes) || compact.budgetBytes < 0))
        invalid();
    let after;
    if (window.continuation !== undefined) {
        try {
            after = JSON.parse(window.continuation);
        }
        catch {
            invalid();
        }
        if (!after || !Number.isFinite(after.score) || after.score <= 0 || !Number.isSafeInteger(after.ordinal) || after.ordinal < 0)
            invalid();
    }
    const scan = (seek, count) => {
        const hash = createHash('sha256'), candidates = [];
        let ordinal = 0, total = 0, eligible = 0, filteredActions = 0;
        for (const source of sources()) {
            const { animations, ...sourceIdentity } = source;
            hash.update(JSON.stringify(sourceIdentity)).update('\0');
            for (const animation of animations) {
                const { events, ...identity } = animation;
                hash.update(JSON.stringify(identity)).update('\0');
                let score = 0;
                if (window.actionFilter && !window.actionFilter(animation))
                    continue;
                const filter = window.eventFilter;
                if (window.actionScore)
                    score = Math.max(score, window.actionScore(animation));
                let filterMatches = 0;
                for (const event of events) {
                    hash.update(JSON.stringify(event)).update('\0');
                    if (filter && !filter(event))
                        continue;
                    filterMatches++;
                    score = Math.max(score, scoreEvent(event));
                }
                // A field filter constrains the candidate set, so an action with no matching event is not a hit. Without
                // this, an empty query's baseline score of 1 kept every action and the filter only changed nothing.
                if (filter && filterMatches === 0) {
                    filteredActions++;
                    continue;
                }
                const rank = { score, ordinal: ordinal++ };
                if (score <= 0)
                    continue;
                total++;
                if (seek && compare(rank, seek) <= 0)
                    continue;
                eligible++;
                retain(candidates, { ...rank, source, animation }, count, compare);
            }
        }
        return { candidates, total, eligible, filteredActions, snapshotId: hash.digest('hex') };
    };
    // Legacy explicit offsets use bounded seek windows. Cursor callers take one
    // scan regardless of page number; offsets never allocate offset+limit hits.
    let remaining = after ? 0 : offset;
    while (remaining > 0) {
        const skipped = scan(after, Math.min(128, remaining));
        if (skipped.candidates.length === 0)
            break;
        const last = skipped.candidates.at(-1);
        after = { score: last.score, ordinal: last.ordinal };
        remaining -= skipped.candidates.length;
    }
    const page = scan(after, limit);
    // Candidates are in rank order, so the shared compact budget goes to the best-ranked actions first.
    let budget = compact?.budgetBytes ?? 0;
    const keep = compact ? compact.pageSize : eventLimit;
    const matches = page.candidates.map(({ source, animation, score }) => {
        const filter = window.eventFilter;
        const events = [], matchedEventIndices = [];
        let maximumBytes = 1, matchedEventCount = 0, filteredEventCount = 0;
        for (const event of animation.events) {
            maximumBytes = Math.max(maximumBytes, Buffer.byteLength(JSON.stringify(event), 'utf8'));
            // With a field filter the answer is the matching events themselves: a page of sibling events would look
            // exactly like the silent miss this filter exists to remove. Without one the native page is unchanged.
            if (filter) {
                if (!filter(event)) {
                    filteredEventCount++;
                    continue;
                }
                matchedEventCount++;
                if (matchedEventIndices.length < 128)
                    matchedEventIndices.push(event.index);
                if (keep > 0)
                    retain(events, event, keep, (a, b) => a.index - b.index);
                continue;
            }
            if (keep > 0)
                retain(events, event, keep, (a, b) => a.index - b.index);
            if (scoreEvent(event) > 0) {
                matchedEventCount++;
                if (matchedEventIndices.length < 128)
                    matchedEventIndices.push(event.index);
            }
        }
        // Index coverage and delivered-window coverage are different contracts.
        const indexedEventsComplete = animation.eventCount !== undefined && animation.events.length === animation.eventCount
            && animation.events.every((event, index) => event.index === index);
        let delivered, size, eventsComplete;
        if (compact) {
            if (filter) {
                // Filtered delivery keeps the matching events in native order and spends the shared budget on them, so
                // a page can never contain an event the caller did not ask for. At least one event is always delivered.
                const encoded = events.map(compactTaeEvent);
                let take = 0, bytes = 0;
                while (take < encoded.length) {
                    const cost = Buffer.byteLength(JSON.stringify(encoded[take]), 'utf8') + 1;
                    if (take > 0 && bytes + cost > budget)
                        break;
                    bytes += cost;
                    take++;
                }
                delivered = encoded.slice(0, take);
                budget -= bytes;
                size = compact.pageSize;
                eventsComplete = filteredEventCount === 0 && take === matchedEventCount;
            }
            else {
                // A compact page holds a fixed number of events, so search and read_tae_events number the same pages. The
                // first page is delivered whole, as a gapless native-order prefix, while the shared budget lasts; otherwise
                // none of it is, and the continuation starts at the action's first event.
                const expected = Math.min(compact.pageSize, animation.eventCount ?? Number.POSITIVE_INFINITY);
                const first = events.length === expected && events.every((event, index) => event.index === index) ? events.map(compactTaeEvent) : [];
                const bytes = Buffer.byteLength(JSON.stringify(first), 'utf8');
                delivered = first.length > 0 && bytes <= budget ? first : [];
                if (delivered.length > 0)
                    budget -= bytes;
                size = compact.pageSize;
                eventsComplete = animation.eventCount !== undefined && delivered.length === animation.eventCount;
            }
        }
        else {
            const previewSize = Math.min(eventLimit, Math.floor(20_000 / limit / maximumBytes));
            // An oversized individual event is not an exception to the preview bound.
            // Omit its preview and leave a one-event native continuation instead.
            size = Math.max(1, previewSize);
            events.length = Math.min(events.length, previewSize);
            delivered = events;
            eventsComplete = filter
                ? filteredEventCount === 0 && events.length === animation.eventCount
                : indexedEventsComplete && events.length === animation.eventCount;
        }
        const selector = animation.taeEntryIndex !== undefined ? { taeEntryIndex: animation.taeEntryIndex }
            : animation.taeEntryId !== undefined ? { taeEntryId: animation.taeEntryId }
                : animation.taeEntryName !== undefined ? { taeEntryName: animation.taeEntryName }
                    : animation.taeGroup !== undefined ? { taeGroup: animation.taeGroup } : {};
        return { score, matchedEventIndices, matchedEventCount,
            ...(filter ? { filteredEventCount } : {}),
            matchedEventIndicesTruncated: matchedEventIndices.length < matchedEventCount,
            item: { ...animation, sourceUri: source.sourceUri, chrId: source.chrId,
                address: formatActionAddress({ chr: source.chrId, animId: animation.animId, ...selector }),
                sourceHash: source.outerFileHash ?? source.sourceHash, sourceRevision: source.sourceRevision, readerSchemaRevision: source.readerSchemaRevision,
                indexedEventsComplete, eventsComplete, eventsTruncated: !eventsComplete,
                ...(filter && filteredEventCount > 0 ? { eventsFiltered: true } : {}),
                events: delivered, eventPageSize: size, ...(compact ? { eventProjection: 'compact' } : {}) } };
    });
    const last = page.candidates.at(-1);
    return { matches, total: page.total, snapshotId: page.snapshotId, retainedCandidates: page.candidates.length,
        ...(window.eventFilter ? { filteredActions: page.filteredActions } : {}),
        ...(last && page.eligible > page.candidates.length ? { continuation: JSON.stringify({ score: last.score, ordinal: last.ordinal }) } : {}) };
}
//# sourceMappingURL=taeActionSearch.js.map