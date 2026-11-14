import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { scanTaeExport } from '../../editing/taeEdit.js';
/** ExplainSkillActions deps: tests inject both readers; production uses the native ones. */
export interface ExplainSkillActionsDeps {
    readParamFields?: typeof readParamFields;
    scanTae?: typeof scanTaeExport;
}
/** explain_skill_actions: one domain tool declaration, schema and handler. */
export declare function createExplainSkillActionsTool(deps?: ExplainSkillActionsDeps): RegisteredTool;
