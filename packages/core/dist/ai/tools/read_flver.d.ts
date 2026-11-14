import type { RegisteredTool } from '../toolRegistry.js';
/**
 * read_flver: one FLVER model document (bounds, meshes, materials, texture
 * slots, bones) projected from the native Bridge document (`read-flver-document`).
 *
 * The same tool covers the three input shapes the Bridge now accepts:
 * loose `.flver`, a DCX-wrapped loose FLVER, and a chrbnd/objbnd/mapbnd
 * container. A container with several `.flver` entries (objbnd/mapbnd ship a
 * body model plus a `_S` variant) cannot be guessed: the Bridge fails with
 * FLVER_CONTAINER_ENTRY_AMBIGUOUS and lists every candidate, and the caller
 * retries with `entryIndex` (or `entryName`). This tool never picks the first
 * child itself.
 */
export declare function createReadFlverTool(): RegisteredTool;
