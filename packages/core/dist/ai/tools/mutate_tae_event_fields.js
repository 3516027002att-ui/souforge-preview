import { asRecord } from '.././toolRegistrySupport.js';
import { asString } from '.././toolRegistrySupport.js';
import { asTaeFieldEdits } from '.././toolRegistrySupport.js';
import { fail } from '.././toolRegistrySupport.js';
import { finalizeCommittedToolResult } from '.././toolRegistrySupport.js';
import { requireEditSession } from '.././toolRegistrySupport.js';
import { setTaeEventFields } from '../../editing/taeEdit.js';
import { parseActionAddress } from '@soulforge/shared';
import { parseTaeAddress, taeProofEntryMatcher } from '../../editing/proofIdentities.js';
/** mutate_tae_event_fields: one domain tool declaration, schema and handler. */
export function createMutateTaeEventFieldsTool() {
    return {
        name: 'mutate_tae_event_fields',
        description: 'Set first-party decoded TAE event fields by exact action address through Patch Engine. '
            + 'edits: one object per event, { address, fieldName | fieldIndex, value }, and fieldName must match the name read_tae_events returned '
            + '(read results carry both name and fieldName with the same value; name alone is also accepted). '
            + 'Padding/assert fields are rejected. '
            + 'Requires a prior address read: a read_tae_events preview page does not authorize a write; call read_tae_events with addresses for this action first.',
        permission: 'commit',
        permissionLevel: 'commit',
        inputSchema: { file: 'string', edits: 'array' },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.domain && value.domain !== 'tae') {
                return fail('DOMAIN_CROSSOVER_REJECTED', `TAE 写入工具不能接收 ${value.domain} 领域的请求。`);
            }
            const file = asString(value.file);
            const edits = asTaeFieldEdits(value.edits);
            if (!file)
                return fail('INVALID_INPUT', 'mutate_tae_event_fields 需要 file。');
            if (!edits.ok)
                return fail(edits.code, edits.message);
            for (const edit of edits.edits) {
                const address = parseActionAddress(edit.address);
                if (!address || address.animId === undefined || address.eventIndex === undefined) {
                    return fail('DOMAIN_CROSSOVER_REJECTED', `TAE 字段写入工具只能接收 TAE 动作事件地址：${edit.address}`);
                }
            }
            const session = requireEditSession(context, 'write');
            if (!('session' in session))
                return session;
            const writtenSections = [...new Set(edits.edits.flatMap((edit) => {
                    const parsed = parseTaeAddress(edit.address);
                    return parsed?.taeEntryIndex === undefined ? [] : [parsed.taeEntryIndex];
                }))];
            const result = await setTaeEventFields({ edit: session.session, file, edits: edits.edits });
            if (!result.ok) {
                // A preview page delivers events but does not authorize a write for every address in it.
                // Say which read unblocks the write instead of leaving a bare NATIVE_READ_REQUIRED.
                const requiredReads = edits.edits.map((edit) => edit.address.replace(/\/e\d+$/, ''));
                if (result.error.code === 'NATIVE_READ_REQUIRED') {
                    return fail(result.error.code, `${result.error.message}；写该事件前先按地址读一次：read_tae_events {file, addresses:["${requiredReads[0]}"]}。`, { requiredReads });
                }
                return fail(result.error.code, result.error.message, result.diagnostics);
            }
            return finalizeCommittedToolResult({ data: result, changedSources: [result.filePath], context,
                // 只让被写事件的 TAE 段过期：同容器其它段的读证明仍然成立。
                ...(writtenSections.length === 0
                    ? {}
                    : { invalidateProofScopes: [{ source: result.filePath, matches: taeProofEntryMatcher(writtenSections) }] }),
                verifyNative: async () => result.nativeVerified ? { ok: true, details: { addresses: result.after.map(event => event.address) } }
                    : { ok: false, code: 'TAE_FIELD_READBACK_FAILED', message: '写入已提交，但原生字段回读未验证；请按 opId 查询或回滚，禁止自动重放。', details: result.diagnostics } });
        }
    };
}
//# sourceMappingURL=mutate_tae_event_fields.js.map