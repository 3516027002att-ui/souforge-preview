import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
/** read_param_fields: one domain tool declaration, schema and handler. */
export declare function createReadParamFieldsTool(deps?: {
    readParamFields?: typeof readParamFields;
}): RegisteredTool;
