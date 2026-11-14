import { asOptionalString, asRecord, asString, fail, finalizeCommittedToolResult, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { setLuabndScript } from '../../editing/luabndEdit.js';
import { setStandaloneHksSource } from '../../editing/hksEdit.js';
/** mutate_luabnd_script: one domain tool declaration, schema and handler. */
export function createMutateLuabndScriptTool() {
    return {
        name: 'mutate_luabnd_script',
        description: 'Modify or replace a Lua AI script inside a *.luabnd.dcx container through Patch Engine. '
            + 'file: path to luabnd container; childPath: target script (e.g. 540000_battle.lua); '
            + 'text: new script text (for plain text or decompiled edits); contentBase64: raw bytes or compiled bytecode. '
            + 'Preserves BND4 container structure, signatures, and layout via Bridge writer.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: {
            file: 'string',
            childPath: 'string?',
            text: 'string?',
            contentBase64: 'string?',
            expectedSourceHash: 'string?',
            expectedContainerHash: 'string?',
            expectedChildHash: 'string?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            const childPath = asString(value.childPath);
            // A standalone .hks is one compiled file, not a container child: decompile with the Bridge,
            // compile the edited source back, and commit the bytes through Patch Engine.
            if (file && !childPath) {
                if (!/\.hks$/iu.test(file))
                    return fail('INVALID_INPUT', '\u5bb9\u5668\u5185\u811a\u672c\u5fc5\u987b\u63d0\u4f9b childPath\uff1b\u53ea\u6709\u72ec\u7acb .hks \u53ef\u4ee5\u7701\u7565\u3002');
                const standaloneText = asOptionalString(value.text);
                if (standaloneText === undefined)
                    return fail('INVALID_INPUT', '\u72ec\u7acb .hks \u5199\u5165\u9700\u8981\u5b8c\u6574\u65b0\u6e90\u7801 text\u3002');
                const resolved = resolveIndexedResourceFile(context, file, 'action');
                if (!resolved.ok)
                    return fail(resolved.code, resolved.message, resolved.details);
                const expectedSourceHash = asOptionalString(value.expectedSourceHash);
                const standalone = await setStandaloneHksSource({
                    edit: edit.session,
                    file: resolved.path,
                    text: standaloneText,
                    ...(expectedSourceHash ? { expectedSourceHash } : {}),
                    ...(context.signal ? { signal: context.signal } : {})
                });
                if (!standalone.ok)
                    return fail(standalone.error?.code ?? 'HKS_MUTATION_FAILED', standalone.error?.message ?? 'HKS \u5199\u5165\u5931\u8d25\u3002', standalone.diagnostics);
                return finalizeCommittedToolResult({
                    data: standalone,
                    changedSources: [standalone.filePath ?? file],
                    context
                });
            }
            if (!file || !childPath)
                return fail('INVALID_INPUT', 'mutate_luabnd_script ��Ҫ file �� childPath��');
            const text = asOptionalString(value.text);
            const contentBase64 = asOptionalString(value.contentBase64);
            if (text === undefined && contentBase64 === undefined) {
                return fail('INVALID_INPUT', 'mutate_luabnd_script ��Ҫ text �� contentBase64��');
            }
            const expectedContainerHash = asOptionalString(value.expectedContainerHash);
            const expectedChildHash = asOptionalString(value.expectedChildHash);
            const result = await setLuabndScript({
                edit: edit.session,
                file,
                childPath,
                ...(text !== undefined ? { text } : {}),
                ...(contentBase64 !== undefined ? { contentBase64 } : {}),
                ...(expectedContainerHash ? { expectedContainerHash } : {}),
                ...(expectedChildHash ? { expectedChildHash } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.diagnostics);
            return finalizeCommittedToolResult({ data: result, changedSources: [result.containerPath], context });
        }
    };
}
//# sourceMappingURL=mutate_luabnd_script.js.map