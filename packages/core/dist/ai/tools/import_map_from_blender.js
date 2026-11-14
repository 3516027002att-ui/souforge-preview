import { asRecord, asString, fail, finalizeCommittedToolResult, requireEditSession } from '../toolRegistrySupport.js';
import { importBlenderDeltaToTransaction } from '@soulforge/shared';
import { executeMapTransaction, loadMapDocument } from '../../editing/mapService.js';
/** import_map_from_blender: one domain tool declaration, schema and handler. */
export function createImportMapFromBlenderTool() {
    return {
        name: 'import_map_from_blender',
        description: 'Import Blender delta modifications, validate against current map revision, and commit as a MapEditTransaction. '
            + 'Only mutations with action="modify" are accepted: create, duplicate and delete have no write proof '
            + 'or validation path yet and are rejected with BLENDER_IMPORT_ACTION_UNSUPPORTED. Export transform '
            + 'changes only from Blender.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: { file: 'string', delta: 'object' },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            const delta = value.delta;
            if (!file || !delta || typeof delta !== 'object')
                return fail('INVALID_INPUT', 'import_map_from_blender 需要 file 和 delta 对象。');
            const loaded = await loadMapDocument(edit.session, file);
            if (!loaded.ok)
                return fail(loaded.error.code, loaded.error.message);
            const translation = importBlenderDeltaToTransaction(loaded.doc, delta);
            if (!translation.ok)
                return fail(translation.conflict ? 'REVISION_CONFLICT' : 'IMPORT_FAILED', translation.error);
            const result = await executeMapTransaction(edit.session, file, translation.transaction);
            if (!result.ok)
                return fail(result.error?.code ?? 'IMPORT_COMMIT_FAILED', result.error?.message ?? 'Blender 地图事务提交失败。', result.error?.details);
            return finalizeCommittedToolResult({
                data: {
                    transaction: translation.transaction,
                    status: result.verification ?? 'completed',
                    result
                },
                changedSources: [file],
                context
            });
        }
    };
}
//# sourceMappingURL=import_map_from_blender.js.map