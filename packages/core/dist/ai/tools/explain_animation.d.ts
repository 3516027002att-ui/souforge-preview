import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { readTaeEvents, scanTaeExport } from '../../editing/taeEdit.js';
/** explain_animation: one domain tool declaration, schema and handler. */
export declare function createExplainAnimationTool(deps?: {
    readParamFields?: typeof readParamFields;
    scanTae?: typeof scanTaeExport;
    readTae?: typeof readTaeEvents;
}): RegisteredTool;
