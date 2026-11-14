import { asOptionalString, asParamEdits, asRecord, fail, finalizeCommittedToolResult, ok, requireEditSession, resolveIndexedResourceFile, verifyCommittedParamFields } from '../toolRegistrySupport.js';
import { setParamFields } from '../../param/containerParamEdit.js';
import { paramProofTableMatcher } from '../../editing/proofIdentities.js';
/** mutate_param_fields: one domain tool declaration, schema and handler. */
export function createMutateParamFieldsTool() {
    return {
        name: 'mutate_param_fields',
        description: 'Set absolute PARAM field values through Patch Engine (write-param + write-bnd4). '
            + 'edits: [{ table, rowId, rowIndex, fieldId, expectedDataHash, value }]; copy rowIndex and dataHash '
            + 'from the latest read when present, and pass the returned containerPath when available. Never multiply current values. '
            + 'Each changed table is committed as its own Patch Engine operation, so the receipt always names the '
            + 'rollback handles: data.opId for a single-table edit, and data.opIds (ordered) plus '
            + 'data.operations[{ table, opId }] when the edits span several tables. A cross-table write therefore has '
            + 'several individually rollable operations; roll them back with rollback_operation in reverse commit '
            + 'order (last opId first). Do not reverse-lookup list_operations by title/time when the receipt carries them. '
            + 'The post-commit native reread under lifecycle.nativeVerification.details.fields reports the new '
            + 'sourceHash with sourceRevisionKind=content-hash and contentRevision, the same content-derived value '
            + 'read_param_fields/search_param_rows give for those bytes; do not compare it against a file mtime. '
            + 'Read proofs are bound to each table\'s own content hash, not to the container: writing NpcParam does not '
            + 'invalidate a read proof for ItemLotParam in the same gameparam container, so "read ItemLotParam, write '
            + 'NpcParam, write ItemLotParam" works without re-reading in between. A table whose own bytes changed '
            + '(written earlier in this session, or modified by another process) must be re-read before it can be '
            + 'written — the gate refuses it with NATIVE_READ_STALE and names the table. '
            + 'Do not parse Smithbox XML, scan BND, or write file_replace by hand.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: {
            edits: 'array',
            containerPath: 'string?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.domain && value.domain !== 'param') {
                return fail('DOMAIN_CROSSOVER_REJECTED', `PARAM 写入工具不能接收 ${value.domain} 领域的请求。`);
            }
            if (value.fieldKind && value.fieldKind !== 'native_value') {
                return fail('FIELD_KIND_NON_NATIVE', `${value.fieldKind} 不是原生字段类型，不能写入 PARAM。`);
            }
            const edits = asParamEdits(value.edits);
            if (!edits.ok)
                return fail(edits.code, edits.message);
            for (const e of edits.edits) {
                if (/^m\d\d_/i.test(e.table) || /^c\d\d/i.test(e.table) || /#A\d\d/i.test(e.table)) {
                    return fail('DOMAIN_CROSSOVER_REJECTED', `PARAM 写入工具不能接收地图或 TAE 目标：${e.table}`);
                }
                const record = e;
                if (record.valueKind === 'display_label' || record.valueKind === 'external_metadata') {
                    return fail('FIELD_KIND_NON_NATIVE', 'display_label / external_metadata 不能作为 PARAM 原生字段写入：请传原生字段值（fieldKind: native_value）。');
                }
            }
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const containerPath = asOptionalString(value.containerPath);
            const result = await setParamFields({
                edit: edit.session,
                edits: edits.edits,
                ...(containerPath ? { containerPath } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.error.details);
            if (result.changedTables.length === 0)
                return ok(result);
            // 编辑层返回的是物理绝对路径；面向模型的回执必须用逻辑 sourceUri，
            // 否则本机路径透出，且调用方无法把该 containerPath 直接用于下一次
            // read/mutate（工具描述要求传回可复用的 containerPath）。
            const resolvedContainer = resolveIndexedResourceFile(context, result.containerPath, 'param');
            const modelContainerPath = resolvedContainer.ok
                ? resolvedContainer.sourceUri
                : (containerPath ?? result.containerPath);
            return finalizeCommittedToolResult({
                data: {
                    ...result,
                    containerPath: modelContainerPath,
                    // Single-table receipts keep the scalar handle callers already parse; the
                    // ordered array is always present for the multi-table case.
                    ...(result.opIds.length === 1 ? { opId: result.opIds[0] } : {})
                },
                changedSources: [result.containerPath],
                // 只有被写的子表字节变了：只让这些子表的读证明过期，同容器其它表继续可用。
                invalidateProofScopes: [{
                        source: result.containerPath,
                        matches: paramProofTableMatcher(result.changedTables)
                    }],
                context,
                verifyNative: () => verifyCommittedParamFields({
                    edit: edit.session,
                    edits: edits.edits,
                    expected: result.after,
                    containerPath: result.containerPath
                })
            });
        }
    };
}
//# sourceMappingURL=mutate_param_fields.js.map