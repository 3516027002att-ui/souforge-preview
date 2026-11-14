import { asOptionalString, asRecord, asString, canonicalScriptSourceUri, fail, nativePathFromFileToken, ok, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { readLuabndScript } from '../../editing/luabndEdit.js';
import { projectScriptReadExport } from '../../references/scriptReadProjection.js';
import { sourceTextPage } from '.././sourceTextPage.js';
/**
 * A script inside a *.luabnd.dcx container is read as one document, exactly like
 * a standalone .hks, not as a prose snippet.
 *
 * Measured over every decodable .lua of a real Sekiro install (11 mod-side
 * containers, 1,048 entries, 299 distinct scripts read through this tool, both
 * plaintext and hks-bytecode decoded by the first-party Bridge): 197 / 3,498 /
 * 40,763 / 60,455 / 120,479 characters for min / median / p90 / p95 / max. The
 * old 2,400-character default and 3,200-byte page ceiling took 2,071 calls to
 * read that set (51 for 800000_battle.lua alone). A page now carries as much
 * text as the Agent envelope allows; 278 of the 299 scripts arrive in one call
 * and the rest page losslessly through sourceOffset/sourceLimit/cursor, with
 * sourceTextComplete still reporting only what was delivered.
 */
const LUABND_SOURCE_TEXT_DEFAULT_LIMIT = 65_536;
const LUABND_SOURCE_TEXT_MAX_LIMIT = 65_536;
const LUABND_SOURCE_TEXT_JSON_BUDGET = 54_000;
/** read_luabnd_script: one domain tool declaration, schema and handler. */
export function createReadLuabndScriptTool() {
    return {
        name: 'read_luabnd_script',
        description: 'Read a native Lua AI script inside a *.luabnd.dcx container (such as script/m11_01_00_00.luabnd.dcx or aicommon.luabnd.dcx). '
            + 'file: relative or absolute path (e.g. script/m11_01_00_00.luabnd.dcx); childPath: script name (e.g. 540000_battle.lua; omit to list scripts). '
            + 'By default it returns the whole source/decompiled text in one call when it fits the Agent budget (most do: 197 / 3,498 / 40,763 / 120,479 characters min/median/p90/max over a real install); larger scripts still page losslessly. '
            + 'The delivered window is the top-level sourceText (script keeps the snapshot metadata); sourceOffset/sourceLimit/startLine/endLine locate it. Use nextCursor with the same file/childPath to read the remaining source; sourceTextComplete states whether the delivered view is the whole script.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            childPath: 'string?',
            expectedContainerHash: 'string?',
            expectedChildHash: 'string?',
            sourceOffset: 'safe-integer?',
            sourceLimit: 'safe-integer?',
            cursor: 'string?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            const childPath = asOptionalString(value.childPath);
            if ((value.cursor !== undefined || value.sourceOffset !== undefined || value.sourceLimit !== undefined) && !childPath) {
                return fail('SCRIPT_CHILD_REQUIRED', '展开源码需要指定 childPath。');
            }
            if (!file)
                return fail('INVALID_INPUT', 'read_luabnd_script ��Ҫ file��');
            const expectedContainerHash = asOptionalString(value.expectedContainerHash);
            const expectedChildHash = asOptionalString(value.expectedChildHash);
            const resolvedFile = resolveIndexedResourceFile(context, file, 'script');
            if (!resolvedFile.ok)
                return fail(resolvedFile.code, resolvedFile.message, resolvedFile.details);
            const result = await readLuabndScript({
                edit: edit.session,
                file: nativePathFromFileToken(resolvedFile.path),
                ...(context.signal ? { signal: context.signal } : {}),
                ...(childPath ? { childPath } : {}),
                ...(expectedContainerHash ? { expectedContainerHash } : {}),
                ...(expectedChildHash ? { expectedChildHash } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.diagnostics);
            if (context.workspaceIndex && childPath) {
                const sourceUri = canonicalScriptSourceUri(context, result.containerPath);
                const script = result.script;
                const existing = context.workspaceIndex.toSymbolBundle().scripts?.find((item) => item.sourceUri === sourceUri);
                const sourceRevision = context.workspaceIndex.getFile(sourceUri)?.mtimeMs;
                context.workspaceIndex.upsertScriptExport(projectScriptReadExport({
                    sourceUri,
                    childPath,
                    script,
                    ...(sourceRevision !== undefined ? { sourceRevision } : {}),
                    ...(existing ? { existing } : {})
                }));
                context.workspaceIndex.rebuildReferences();
                await context.onSemanticEvidenceUpdated?.([sourceUri]);
            }
            if (childPath && typeof result.script.sourceText === 'string') {
                try {
                    const sourceUri = canonicalScriptSourceUri(context, result.containerPath);
                    const { sourceText, ...page } = sourceTextPage({
                        text: result.script.sourceText,
                        sourceKey: `${context.workspaceIndex?.workspaceId ?? edit.session.session.meta.workspaceId}|${sourceUri}!/${childPath}`,
                        sourceHash: result.script.sourceHash,
                        domain: 'script',
                        defaultLimit: LUABND_SOURCE_TEXT_DEFAULT_LIMIT,
                        maxLimit: LUABND_SOURCE_TEXT_MAX_LIMIT,
                        jsonBudget: LUABND_SOURCE_TEXT_JSON_BUDGET,
                        ...(value.sourceOffset !== undefined ? { sourceOffset: value.sourceOffset } : {}),
                        ...(value.sourceLimit !== undefined ? { sourceLimit: value.sourceLimit } : {}),
                        ...(value.cursor !== undefined ? { cursor: value.cursor } : {})
                    });
                    // The body travels exactly once. Shipping it under `script.sourceText` as well
                    // halves the usable envelope: two 54,000-byte JSON copies plus identity exceed the
                    // 64 KiB Agent budget, so scripts between ~27K and 54K characters would fail
                    // outright instead of arriving whole. `record.sourceText` (the read_hks_script
                    // spelling) is the delivered window; `script` keeps the snapshot metadata.
                    const { textPreview: _preview, derivedSource: _derived, embeddedSymbols: _symbols, sourceText: _scriptSourceText, ...snapshot } = result.script;
                    return ok({
                        ...result,
                        sourceUri,
                        childPath,
                        sourceText,
                        script: { ...snapshot, sourceTextComplete: page.sourceTextComplete },
                        ...page,
                        nextActions: page.nextCursor ? [{
                                tool: 'read_luabnd_script',
                                args: { file: sourceUri, childPath, cursor: page.nextCursor },
                                reason: '继续读取后续源码'
                            }] : []
                    });
                }
                catch (error) {
                    return fail(error.code ?? 'SOURCE_WINDOW_FAILED', error instanceof Error ? error.message : '源码窗口读取失败。');
                }
            }
            return ok(result);
        }
    };
}
//# sourceMappingURL=read_luabnd_script.js.map