import { asNumber, asOptionalString, asRecord, asString, fail, finalizeCommittedToolResult, requireEditSession, resolveIndexedResourceFile } from '../toolRegistrySupport.js';
import { setParamFields } from '../../param/containerParamEdit.js';
import { paramProofTableMatcher } from '../../editing/proofIdentities.js';
const NAME_ENCODINGS = new Set(['utf16le', 'shiftjis', 'ascii']);
/**
 * create_param_row: one domain tool declaration, schema and handler.
 *
 * Creation is a distinct operation from `mutate_param_fields` (which only edits rows that
 * already exist): it has a conflict rule (`PARAM_ROW_ALREADY_EXISTS`, never overwrite), an ordered
 * insertion position, and an optional whole-row copy. It shares the PARAM write facade and
 * therefore the same Patch Engine path, rollback handle and native reread.
 */
export function createCreateParamRowTool() {
    return {
        name: 'create_param_row',
        description: 'Create one new PARAM row through Patch Engine (write-param add + write-bnd4). '
            + 'Required: table, rowId, rowName. Optional: copyFrom { table?, rowId, rowIndex? } copies every '
            + 'field of an existing row before `fields` are applied, and fields: [{ fieldId, value }] sets absolute '
            + 'values on the new row. Omitting copyFrom seeds a literal all-zero row, so prefer copyFrom for tables '
            + 'whose defaults matter. An existing rowId is refused with PARAM_ROW_ALREADY_EXISTS and is never '
            + 'overwritten; this is the tool to reach for when a row must be added (for example a dedicated '
            + 'SpEffectParam row for one NpcParam owner) instead of reusing a row another object also points at. '
            + 'The new row is inserted at its sorted position in the ordered native row table (Sekiro row ids are '
            + 'strictly ascending), not appended after larger ids; every existing row\'s data offset is rebased by '
            + 'the Bridge, and their name-pool entries keep their exact bytes and offsets. Existing rows are not '
            + 'rewritten. The post-commit reread returns created.rowIndex/insertIndex/dataHash plus '
            + 'lifecycle.nativeVerification with the preserved-row count, so "other rows did not change" is checked, '
            + 'not assumed. Roll back with rollback_operation using the returned opId/opIds like any other PARAM write. '
            + 'Read the target table first: the read gate requires the WHOLE table\'s row set, delivered page by page '
            + 'by read_param_fields { allRows: true, rowOffset, rowLimit } from rowOffset=0 until hasMore=false. '
            + 'One field read (or one page) does not authorize creation: a partial read is refused with '
            + 'NATIVE_READ_COVERAGE_INCOMPLETE naming the missing row ranges and the rowOffset to resume from. '
            + 'A spelling that matches more than one physical table (BEHAVIOR_PARAM_ST reaches both BehaviorParam and '
            + 'BehaviorParam_PC) is refused with PARAM_TABLE_AMBIGUOUS: pass the physical table name. Such a spelling '
            + 'also pins no content version, so only with the physical name is "this table was not changed" an '
            + 'actually checked claim.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: {
            table: 'string',
            rowId: 'safe-integer',
            rowName: 'string',
            copyFrom: 'object?',
            fields: 'array?',
            nameEncoding: 'string?',
            containerPath: 'string?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.domain && value.domain !== 'param') {
                return fail('DOMAIN_CROSSOVER_REJECTED', `PARAM 创建工具不能接收 ${value.domain} 领域的请求。`);
            }
            const table = asString(value.table);
            const rowName = asString(value.rowName);
            const rowId = asNumber(value.rowId, Number.NaN);
            if (!table || !rowName || !Number.isSafeInteger(rowId)) {
                return fail('INVALID_INPUT', 'create_param_row 需要 table、rowId（整数）和 rowName。');
            }
            if (/^m\d\d_/i.test(table) || /^c\d\d/i.test(table) || /#A\d\d/i.test(table)) {
                return fail('DOMAIN_CROSSOVER_REJECTED', `PARAM 创建工具不能接收地图或 TAE 目标：${table}`);
            }
            const fields = [];
            if (value.fields !== undefined) {
                if (!Array.isArray(value.fields)) {
                    return fail('INVALID_INPUT', 'fields 必须是 [{ fieldId, value }] 数组。');
                }
                for (const item of value.fields) {
                    const field = asRecord(item);
                    const fieldId = asString(field.fieldId);
                    const raw = field.value;
                    if (!fieldId || (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean')) {
                        return fail('INVALID_INPUT', '每条 fields 都需要 fieldId 和 number/string/boolean 的 value。');
                    }
                    fields.push({ fieldId, value: raw });
                }
            }
            let copyFrom;
            if (value.copyFrom !== undefined) {
                const copy = asRecord(value.copyFrom);
                const copyRowId = asNumber(copy.rowId, Number.NaN);
                if (!Number.isSafeInteger(copyRowId)) {
                    return fail('INVALID_INPUT', 'copyFrom 需要整数 rowId。');
                }
                const copyTable = asOptionalString(copy.table);
                if (copy.rowIndex !== undefined
                    && (typeof copy.rowIndex !== 'number' || !Number.isSafeInteger(copy.rowIndex) || copy.rowIndex < 0)) {
                    return fail('INVALID_INPUT', 'copyFrom.rowIndex 必须是非负安全整数。');
                }
                copyFrom = {
                    ...(copyTable ? { table: copyTable } : {}),
                    rowId: copyRowId,
                    ...(typeof copy.rowIndex === 'number' ? { rowIndex: copy.rowIndex } : {})
                };
            }
            const rawEncoding = asOptionalString(value.nameEncoding);
            if (rawEncoding !== undefined && !NAME_ENCODINGS.has(rawEncoding)) {
                return fail('INVALID_INPUT', 'nameEncoding 只接受 utf16le / shiftjis / ascii。');
            }
            const nameEncoding = rawEncoding;
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const containerPath = asOptionalString(value.containerPath);
            const result = await setParamFields({
                edit: edit.session,
                edits: [],
                create: {
                    table,
                    rowId,
                    rowName,
                    ...(fields.length > 0 ? { fields } : {}),
                    ...(copyFrom !== undefined ? { copyFrom } : {}),
                    ...(nameEncoding !== undefined ? { nameEncoding } : {})
                },
                ...(containerPath ? { containerPath } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.error.details);
            if (result.created === undefined) {
                return fail('PARAM_CREATE_RECEIPT_MISSING', '创建调用没有返回新行回执；不能把它当成已创建。');
            }
            // The editing layer returns a physical absolute path; the model-facing receipt must use
            // the logical sourceUri so it can be passed back to read/mutate unchanged.
            const resolvedContainer = resolveIndexedResourceFile(context, result.containerPath, 'param');
            const modelContainerPath = resolvedContainer.ok
                ? resolvedContainer.sourceUri
                : (containerPath ?? result.containerPath);
            const verification = result.verification;
            return finalizeCommittedToolResult({
                data: {
                    ...result,
                    containerPath: modelContainerPath,
                    ...(result.opIds.length === 1 ? { opId: result.opIds[0] } : {})
                },
                changedSources: [result.containerPath],
                // Only the written table's bytes changed; other children of the same container keep their proofs.
                invalidateProofScopes: [{
                        source: result.containerPath,
                        matches: paramProofTableMatcher(result.changedTables)
                    }],
                context,
                verifyNative: async () => verification ?? {
                    ok: false,
                    code: 'PARAM_CREATE_POSTCOMMIT_VERIFICATION_MISSING',
                    message: '创建已提交，但没有形成提交后的原生整表回读回执；必须回滚或重新读取确认。'
                }
            });
        }
    };
}
//# sourceMappingURL=create_param_row.js.map