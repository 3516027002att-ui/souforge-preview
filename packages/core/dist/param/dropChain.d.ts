/**
 * Drop-chain resolution: NpcParam.itemLotId_* → ItemLotParam slot → EquipParamGoods.isConsume.
 *
 * Why this module exists (F6, round 43 blind test T1): "does killing this NPC actually unlock the
 * item" was answerable only by a human reading three tables. `find_references` on the goods row
 * returned only text relations, `search_param_rows` returned 177 fuzzy matches, and nothing anywhere
 * said "this NPC has no lot at all" or "this lot only rolls a display prop". Each of those facts is a
 * mechanical comparison of three rows, so it belongs in one resolver with an explicit verdict.
 *
 * The resolver is pure: the caller injects a native row reader, so the verdict logic is testable
 * without a game install, and the tool wrapper is the only place that knows about Bridge reads.
 *
 * Round 4 fix: boss `NpcParam` rows keep `itemLotId_*` at -1 (ordinary enemies do use the param
 * path; see NpcParam#10100000), and boss drops are granted by `AwardItemLot` in the kill event.
 * The caller can inject the EMEVD join (`param/dropChainEmevd.ts`) so an empty param path is not
 * reported as `broken` before the event path has been checked. `broken` is reserved for a drop
 * reference that exists but does not close; "checked both paths and found nothing" is
 * `not-applicable` (ordinary NPC / handler-driven defeat) or `inconclusive` (coverage gap).
 * `paths` states which paths were actually checked.
 */
import type { DropChainEmevdEvidence } from './dropChainEmevd.js';
/** Sekiro NpcParam slot fields. The schema ships itemLotId_1..6; 7/8 are probed for future-proofing. */
export declare const DROP_CHAIN_NPC_LOT_FIELD_IDS: readonly ["itemLotId_1", "itemLotId_2", "itemLotId_3", "itemLotId_4", "itemLotId_5", "itemLotId_6", "itemLotId_7", "itemLotId_8"];
/**
 * ITEMLOT_PARAM_ST v2 carries eight item slots. Slots are discovered by field-id pattern rather than
 * assumed to exist, so a schema with fewer (or more) slots reports what it actually has.
 */
export declare const DROP_CHAIN_LOT_SLOT_FIELD_IDS: readonly string[];
/**
 * `lotItemCategoryNN` selects the target table; the values come from the first-party schema `refs` of
 * lotItemId01..08 (`EquipParamGoods(lotItemCategory01=1073741824)` etc.).
 */
export declare const DROP_CHAIN_CATEGORY_TABLES: Readonly<Record<number, string>>;
export type DropChainVerdict = 'unlocks' | 'display-only' | 'not-applicable' | 'inconclusive' | 'broken';
export type DropChainSlotState = 'unlocks' | 'display-only' | 'missing' | 'unknown-category' | 'unverified' | 'empty';
export interface DropChainFieldValue {
    table: string;
    rowId: number;
    fieldId: string;
    value: number | string | boolean | null;
    rowName?: string;
}
export interface DropChainReadResult {
    fields: DropChainFieldValue[];
    missingRows: Array<{
        table: string;
        rowId: number;
    }>;
    missingFields?: Array<{
        table: string;
        fieldId: string;
        rowIds: number[];
    }>;
    /** The reader stopped at its page cap; the chain may be missing rows it never delivered. */
    truncated?: boolean;
}
export interface DropChainReadQuery {
    table: string;
    rowIds: number[];
    fieldIds: string[];
}
/** Injected native read. The tool wrapper maps this onto the Bridge-backed PARAM reader. */
export type DropChainReadFn = (queries: DropChainReadQuery[]) => Promise<DropChainReadResult>;
export interface DropChainTarget {
    table: string;
    rowId: number;
    rowName?: string;
    /** `null` when the field was not delivered; `null` is never treated as "not a display item". */
    isConsume: number | null;
}
export interface DropChainSlot {
    /** `01`..`08`, matching the field suffix, not an array index. */
    slot: string;
    itemIdFieldId: string;
    itemId: number;
    count: number | null;
    category: number | null;
    targetTable: string | null;
    state: DropChainSlotState;
    target?: DropChainTarget;
}
export interface DropChainLot {
    itemLotId: number;
    rowName?: string;
    found: boolean;
    slots: DropChainSlot[];
    emptySlotCount: number;
}
export interface DropChainBreak {
    /** Stable machine code: ITEM_LOT_ID_UNSET, LOT_SLOT_DISPLAY_ONLY, LOT_SLOT_ROW_MISSING, … */
    code: string;
    severity: 'error' | 'warning';
    /** Which hop failed, in the same `<table>#<rowId>.<field>` form the answer sentence uses. */
    hop: string;
    message: string;
}
export type DropChainPathState = 'found' | 'none' | 'unavailable' | 'inconclusive';
export interface DropChainPathStatus {
    checked: boolean;
    state: DropChainPathState;
    detail: string;
}
/** Compact evidence copied from {@link DropChainEmevdEvidence} into the answer payload. */
export interface DropChainEmevdSummary {
    instanceCount: number;
    entityIds: number[];
    candidateEventCount: number;
    candidateEvents: Array<{
        eventUri: string;
        sourceUri: string;
        eventId: number;
        entityIds: number[];
    }>;
    awards: Array<{
        itemLotId: number;
        eventUri: string;
        sourceUri: string;
        eventId: number;
        instructionIndex: number;
        instructionName: string;
        statement: string;
    }>;
    unresolvedAwardCount: number;
    unresolvedAwards: Array<{
        eventUri: string;
        instructionIndex: number;
        statement: string;
    }>;
    unassociatedAwardCount: number;
    unassociatedAwards: Array<{
        itemLotId: number;
        eventUri: string;
        instructionIndex: number;
        statement: string;
    }>;
    handlers: Array<{
        eventUri: string;
        eventId: number;
        instructionIndex: number;
        instructionName: string;
        statement: string;
    }>;
    coverage: DropChainEmevdEvidence['coverage'];
    notes: string[];
}
export interface DropChainStart {
    kind: 'npc-param' | 'item-lot';
    table?: string;
    rowId?: number;
    rowName?: string;
    itemLotId?: number;
    itemLotIdFields?: Array<{
        fieldId: string;
        value: number;
        state: 'set' | 'unset';
    }>;
    /** Present whenever the caller supplied the EMEVD join. */
    emevevd?: DropChainEmevdSummary;
}
export interface DropChainResult {
    verdict: DropChainVerdict;
    /** One sentence a caller can relay verbatim; it always names the verdict and the reason. */
    answer: string;
    start: DropChainStart;
    lots: DropChainLot[];
    unlocks: DropChainTarget[];
    displayOnly: DropChainTarget[];
    breaks: DropChainBreak[];
    diagnostics: string[];
    /** Which drop paths were checked, and what each one found. */
    paths: {
        param: DropChainPathStatus;
        emevevd: DropChainPathStatus;
    };
}
export interface DropChainInput {
    /** Start table; defaults to NpcParam. Ignored when itemLotId is given. */
    table?: string;
    rowId?: number;
    /** Trace this lot directly (for example the id read from an EMEVD AwardItemLot argument). */
    itemLotId?: number;
    read: DropChainReadFn;
    /**
     * EMEVD join for a NpcParam row. `undefined` means the caller did not request it (legacy
     * param-only call); `null` means it was requested but unavailable (no workspace event index).
     * The distinction matters: only an actually checked, complete EMEVD path may support a
     * `not-applicable`/`broken` claim about absence.
     */
    emevevd?: DropChainEmevdEvidence | null;
    emevevdUnavailableReason?: string;
}
export type DropChainError = {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
export type DropChainResolution = {
    ok: true;
    result: DropChainResult;
} | DropChainError;
/**
 * Read the lot rows, then the rows their slots point at, then decide.
 *
 * The verdict stays deliberately coarse (three states) while `breaks` stays specific: a caller needs
 * one word to answer "does this unlock anything", and the exact hop when the answer is no.
 */
export declare function resolveDropChain(input: DropChainInput): Promise<DropChainResolution>;
