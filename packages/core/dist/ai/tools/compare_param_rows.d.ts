import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
/**
 * compare_param_rows: which fields actually differ between a set of rows.
 *
 * "Which field makes these rows elite?" was unanswerable: the 352 fields of NpcParam can only be listed,
 * one page at a time, and comparing them by hand across eight rows is not something an agent can do
 * reliably. This returns the differences themselves — the fields whose values are not the same in every
 * selected row — so the discriminating field is in the answer instead of inferred from prose.
 *
 * The values are not re-derived here. `read_param_fields` and this tool both reach the same native
 * reader (`readParamFields`), and this tool now *is* that read: it asks for the whole trusted row
 * (`fieldIds: []`) and compares the cells the read delivered. It used to enumerate the field ids with a
 * second metadata walk and then fold every cell onto `values[rowId]`. Two consequences of that were
 * exactly the defect this replaces:
 *
 *   - a logical row with more than one physical row (23 such ids exist in the shipped Sekiro
 *     gameparam: ObjectParam 9035/106010/…, TalkParam 1101800/…, CutsceneParam 10000000/…) collapsed
 *     to whichever physical row the cell list happened to end on, while `read_param_fields` reports one
 *     cell per physical row — the same rowId + fieldId then had two different values depending on which
 *     tool you asked;
 *   - a value that JSON cannot spell distinctly (`0` vs `-0`, which `JSON.stringify` both render as
 *     `0`) was called constant, so the difference `read_param_fields` reports never appeared here.
 *
 * Both are fixed by keying on the physical identity the read delivered (entry + rowIndex + rowId) and by
 * comparing value signatures that keep `-0` distinct. When any requested row resolves to more than one
 * physical row the response switches to `rowId@rowIndex` keys and names the duplicated ids, so no
 * physical value is ever dropped or merged.
 */
export declare function createCompareParamRowsTool(deps?: {
    readParamFields?: typeof readParamFields;
}): RegisteredTool;
