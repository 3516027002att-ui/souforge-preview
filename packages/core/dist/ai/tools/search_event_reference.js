import { asNumber, asRecord, asString, fail, ok } from '../toolRegistrySupport.js';
import { classifyActionLevelQuery, EVENT_REFERENCE_SOURCE_URI, searchEventReference } from '.././eventReference.js';
/** search_event_reference: one domain tool declaration, schema and handler. */
export function createSearchEventReferenceTool() {
    return {
        name: 'search_event_reference',
        description: 'Search the community-maintained Sekiro event-experience glossary by Chinese behavior, English instruction '
            + 'name, or alias. This is a non-authoritative reference map: it guides semantic planning but never proves an instruction exists '
            + 'in the current EMEVD. Always follow with search_events and read_emevd_event using the returned names, '
            + 'file, eventId, and native source evidence. Terms that describe a combat move (突刺/下段危/射箭/连招/追斩 …) are action-layer '
            + 'concepts and cannot be EMEVD instructions; for those the result carries route:"action-level" with the TAE/PARAM tool chain.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { query: 'string', limit: 'number?' },
        run: (input) => {
            const value = asRecord(input);
            const query = asString(value.query, '').trim();
            if (!query)
                return fail('INVALID_INPUT', 'search_event_reference 需要非空 query。');
            const matches = searchEventReference(query, asNumber(value.limit, 20));
            // A move term has no instruction, but "not in the glossary" would send the agent looking for one.
            const actionConcept = matches.length === 0 ? classifyActionLevelQuery(query) : undefined;
            if (actionConcept) {
                return ok({
                    query,
                    sourceUri: EVENT_REFERENCE_SOURCE_URI,
                    authority: 'community-reference',
                    route: 'action-level',
                    totalHits: 0,
                    matches: [],
                    // The envelope keeps only known result keys, so the routing explanation rides in `note`.
                    note: `「${actionConcept.term}」是动作层概念，不是 EMEVD 指令。${actionConcept.guidance} 事件层只负责触发条件与奖励。`,
                    nextActions: actionConcept.tools.map((tool) => ({
                        tool,
                        reason: `动作层概念「${actionConcept.term}」不使用 EMEVD 指令检索。`
                    }))
                });
            }
            return ok({
                query,
                sourceUri: EVENT_REFERENCE_SOURCE_URI,
                authority: 'community-reference',
                route: 'event-instruction',
                totalHits: matches.length,
                matches,
                note: '社区经验用于语义定位和方案组织；当前事件号、指令签名、参数和写入身份必须由 native EMEVD/EMEDF 复核。'
            });
        }
    };
}
//# sourceMappingURL=search_event_reference.js.map