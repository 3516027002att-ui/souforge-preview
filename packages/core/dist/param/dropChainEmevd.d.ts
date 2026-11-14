/**
 * EMEVD half of the drop chain: NpcParam row → MSB instance → entityId → events
 * that reference that instance → `AwardItemLot` instructions in those events.
 *
 * Why this module exists: Sekiro does not publish boss drops through
 * `NpcParam.itemLotId_*` (boss rows keep those fields at -1; ordinary enemies do
 * use them). The boss item is granted by the map event; the first-party schema defines
 * `AwardItemLot(itemLotId)` with no entity argument. The only mechanical join
 * from an NPC row to an award is the native MSB `npcParamRowId` foreign key
 * (row → part → entityId) plus the event instruction index (entityId → events).
 * `AwardItemLot` is then read from those same events.
 *
 * Pure: the caller injects the symbol bundle and the already-built event
 * instruction index, so the join is testable without a game install.
 */
import type { SymbolBundle } from '@soulforge/shared';
import type { EventInstructionIndex } from '../references/eventInstructionIndex.js';
export interface DropChainEmevdInstance {
    mapId: string;
    partName: string;
    entityId?: number;
    mapSourceUri?: string;
}
export interface DropChainEmevdCandidateEvent {
    sourceUri: string;
    mapId?: string;
    eventId: number;
    eventUri: string;
    /** Entity ids of this NPC's instances that the event literally references. */
    entityIds: number[];
}
export interface DropChainEmevdAward {
    itemLotId: number;
    sourceUri: string;
    mapId?: string;
    eventId: number;
    eventUri: string;
    instructionIndex: number;
    instructionName: string;
    args: Readonly<Record<string, string | number | boolean>>;
    statement: string;
    entityId?: number;
}
export interface DropChainEmevdUnresolvedAward {
    sourceUri: string;
    mapId?: string;
    eventId: number;
    eventUri: string;
    instructionIndex: number;
    instructionName: string;
    /** True when `itemLotId` is a common-event parameter and cannot be read from EMEVD. */
    parameterized: boolean;
    statement: string;
    entityId?: number;
}
export interface DropChainEmevdDefeatHandler {
    sourceUri: string;
    mapId?: string;
    eventId: number;
    eventUri: string;
    instructionIndex: number;
    instructionName: string;
    statement: string;
    entityId?: number;
}
export interface DropChainEmevdCoverage {
    /** Only the files that can carry this row's events: its maps plus common/common_func. */
    status: 'complete' | 'partial' | 'unavailable';
    filesDiscovered: number;
    filesRead: number;
    filesFailed: number;
    unknownInstructions: number;
    decodeFailures: number;
    /** True only when every relevant file was read and fully decoded. */
    complete: boolean;
}
export interface DropChainEmevdEvidence {
    table: string;
    rowId: number;
    instances: DropChainEmevdInstance[];
    entityIds: number[];
    candidateEvents: DropChainEmevdCandidateEvent[];
    /** Literal `AwardItemLot` ids in defeat events (the kill reward candidates). */
    awards: DropChainEmevdAward[];
    /**
     * Literal `AwardItemLot` ids in events that reference the entity but carry no death/defeat
     * condition. They are not used as the kill chain: a cutscene may mention the NPC and award
     * an unrelated lot. Kept so "we saw an award but could not attribute it" stays visible.
     */
    unassociatedAwards: DropChainEmevdAward[];
    /** `AwardItemLot` calls whose itemLotId is an event parameter (unattributable). */
    unresolvedAwards: DropChainEmevdUnresolvedAward[];
    /** Defeat-handler instructions in the candidate events. */
    handlers: DropChainEmevdDefeatHandler[];
    coverage: DropChainEmevdCoverage;
    notes: string[];
}
/**
 * Join one NpcParam row to its EMEVD awards.
 *
 * Coverage is scoped to the row's maps plus `common`/`common_func` (where boss
 * kill handlers commonly live); an unread file in an unrelated map cannot turn
 * this row's "no award" into "cannot decide". Missing instances are different:
 * without an entityId there is no join at all, so the caller gets `complete=false`.
 */
export declare function collectDropChainEmevdEvidence(input: {
    rowId: number;
    table?: string;
    bundle: Pick<SymbolBundle, 'maps'>;
    index: EventInstructionIndex;
}): DropChainEmevdEvidence;
