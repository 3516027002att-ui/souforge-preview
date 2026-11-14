import type { RegisteredTool } from '../toolRegistry.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { scanTaeExport } from '../../editing/taeEdit.js';
/** IdentifySkillAction deps: tests inject both readers; production uses the native ones. */
export interface IdentifySkillActionDeps {
    readParamFields?: typeof readParamFields;
    scanTae?: typeof scanTaeExport;
}
/** identify_skill_action: one domain tool declaration, schema and handler. */
export declare function createIdentifySkillActionTool(deps?: IdentifySkillActionDeps): RegisteredTool;
