import type { RegisteredTool } from '../toolRegistry.js';
/**
 * read_tpf: texture inventory of a TPF package, projected from the native
 * Bridge document (`read-tpf-document`). The TypeScript side owns the page
 * window and the model-facing field names; it never parses TPF bytes.
 *
 * A BND4/DCX container that holds more than one `.tpf` fails closed in the
 * Bridge (`TPF_CONTAINER_ENTRY_AMBIGUOUS`) and lists every candidate; the
 * caller must pass `entryIndex` (or `entryName`) to pick one. This tool never
 * silently reads "the first" package.
 */
export declare function createReadTpfTool(): RegisteredTool;
