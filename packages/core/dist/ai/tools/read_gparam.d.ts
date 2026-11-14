import type { RegisteredTool } from '../toolRegistry.js';
/**
 * read_gparam: group inventory and numeric fields of a Sekiro GPARAM bank,
 * projected from the native Bridge document (`read-gparam-document`).
 *
 * `group` is the numeric groupId the group list reports, so the model never
 * has to guess a group by position; both modes page the same way.
 *
 * A BND4 container that holds more than one `.gparam` fails closed in the
 * Bridge (`GPARAM_CONTAINER_ENTRY_AMBIGUOUS`) and lists every candidate; the
 * caller must pass `entryIndex` (or `entryName`) to pick one.
 */
export declare function createReadGparamTool(): RegisteredTool;
