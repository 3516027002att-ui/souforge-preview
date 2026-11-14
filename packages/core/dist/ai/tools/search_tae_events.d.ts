import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
/** search_tae_events: one domain tool declaration, schema and handler. */
export declare function createSearchTaeEventsTool(deps?: {
    readParamFields?: typeof readParamFields;
}): RegisteredTool;
