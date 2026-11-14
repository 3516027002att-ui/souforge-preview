import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { readEmevdEvent } from '../../editing/emevdEdit.js';
/**
 * compare_with_base: the same file in the workspace and in the game base root.
 *
 * "Is this vanilla, or did I change it?" used to require knowing which tool to
 * read twice and doing the comparison by hand. This tool hashes both layers and,
 * when they differ, says *where*: container entries (per-child sha256), a PARAM
 * table's fields, or one EMEVD event's instructions. It reads both sides through
 * the same native readers as the read_* tools; it never invents a decoder.
 */
export declare function createCompareWithBaseTool(deps?: {
    readParamFields?: typeof readParamFields;
    readEmevdEvent?: typeof readEmevdEvent;
}): RegisteredTool;
