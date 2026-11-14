import type { RegisteredTool } from '../toolRegistry.js';
/**
 * create_param_row: one domain tool declaration, schema and handler.
 *
 * Creation is a distinct operation from `mutate_param_fields` (which only edits rows that
 * already exist): it has a conflict rule (`PARAM_ROW_ALREADY_EXISTS`, never overwrite), an ordered
 * insertion position, and an optional whole-row copy. It shares the PARAM write facade and
 * therefore the same Patch Engine path, rollback handle and native reread.
 */
export declare function createCreateParamRowTool(): RegisteredTool;
