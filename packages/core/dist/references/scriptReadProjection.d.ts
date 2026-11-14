import type { ScriptExport } from '@soulforge/shared';
import type { LuabndScriptSnapshot } from '../editing/luabndEdit.js';
export interface ScriptReadProjectionInput {
    sourceUri: string;
    childPath: string;
    script: Pick<LuabndScriptSnapshot, 'sourceText' | 'sourceHash' | 'outerFileHash' | 'isBytecode' | 'warnings'>;
    sourceRevision?: number;
    existing?: ScriptExport;
}
/** Project one native LUABND child read into the indexed export. */
export declare function projectScriptReadExport(input: ScriptReadProjectionInput): ScriptExport;
