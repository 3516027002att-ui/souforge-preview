import { asFmgEdits, asOptionalString, asRecord, fail, finalizeCommittedToolResult, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { setFmgEntries } from '../../editing/fmgEdit.js';
/** mutate_fmg_entries: one domain tool declaration, schema and handler. */
export function createMutateFmgEntriesTool() {
    return {
        name: 'mutate_fmg_entries',
        description: 'Set FMG entry text through Patch Engine (write-fmg mutations[]). '
            + 'edits: [{ table, id, text }]. One table per call. Do not propose_text_patch on .fmg/.msgbnd. '
            + 'Adding a NEW id has no existing entry to prove: the write gate falls back to the table\'s container proof, '
            + 'which requires the WHOLE entry set delivered page by page by read_fmg_entries { allEntries: true, offset } '
            + 'from offset=0 until hasMore=false. Reading a page of ids (or one page) is refused with '
            + 'NATIVE_READ_COVERAGE_INCOMPLETE naming the missing entry ranges and the offset to resume from.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: {
            edits: 'array',
            containerPath: 'string?',
            lang: 'string?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.domain && value.domain !== 'fmg') {
                return fail('DOMAIN_CROSSOVER_REJECTED', `FMG 写入工具不能接收 ${value.domain} 领域的请求。`);
            }
            if (value.fieldKind && value.fieldKind !== 'native_value') {
                return fail('FIELD_KIND_NON_NATIVE', `${value.fieldKind} 不是原生字段类型，不能写入 FMG。`);
            }
            const edits = asFmgEdits(value.edits);
            if (!edits.ok)
                return fail(edits.code, edits.message);
            for (const e of edits.edits) {
                if (/^m\d\d_/i.test(e.table) || /^c\d\d/i.test(e.table) || /#c\d\d/i.test(e.table) || /#A\d\d/i.test(e.table)) {
                    return fail('DOMAIN_CROSSOVER_REJECTED', `FMG 写入工具不能接收地图或 TAE 目标：${e.table}`);
                }
                const record = e;
                if (record.valueKind === 'display_label' || record.fieldId === 'displayLabel') {
                    return fail('FIELD_KIND_NON_NATIVE', 'display_label 是界面显示标签，不能作为 FMG 原生文本写入：请传原生文本（valueKind: native_value）。');
                }
                if (record.valueKind === 'external_metadata' || record.fieldId === 'externalMetadata') {
                    return fail('FIELD_KIND_NON_NATIVE', 'external_metadata 是外部元数据，不能作为 FMG 原生文本写入：请传原生文本（valueKind: native_value）。');
                }
            }
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const containerPath = asOptionalString(value.containerPath);
            const lang = asOptionalString(value.lang);
            const result = await setFmgEntries({
                edit: edit.session,
                edits: edits.edits,
                ...(containerPath ? { containerPath } : {}),
                ...(lang ? { lang } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.error.details);
            // Same projection as mutate_param_fields: an absolute host path in the receipt is not reusable by
            // the caller and leaks the local filesystem; hand back the logical source URI instead.
            const resolvedContainer = resolveIndexedResourceFile(context, result.containerPath, 'msg');
            const modelContainerPath = resolvedContainer.ok
                ? resolvedContainer.sourceUri
                : (containerPath ?? result.containerPath);
            return finalizeCommittedToolResult({
                data: { ...result, containerPath: modelContainerPath },
                changedSources: [result.containerPath],
                context
            });
        }
    };
}
//# sourceMappingURL=mutate_fmg_entries.js.map