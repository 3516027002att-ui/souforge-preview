import { asRecord } from '.././toolRegistrySupport.js';
import { asString } from '.././toolRegistrySupport.js';
import { fail } from '.././toolRegistrySupport.js';
import { finalizeCommittedToolResult } from '.././toolRegistrySupport.js';
import { insertTaeEvents } from '../../editing/taeEdit.js';
import { nativePathFromFileToken } from '.././toolRegistrySupport.js';
import { requireEditSession } from '.././toolRegistrySupport.js';
import { resolveIndexedResourceFile } from '.././toolRegistrySupport.js';
import { parseTaeAddress, taeProofEntryMatcher } from '../../editing/proofIdentities.js';
/** insert_tae_events: one domain tool declaration, schema and handler. */
export function createInsertTaeEventsTool() {
    return {
        name: 'insert_tae_events',
        description: 'Append native TAE events through Patch Engine in one audited commit. Each event needs an action-level address, eventTypeId, startFrame/endFrame, and a template {file?, address}: address must be an exact event address, and file optionally names the workspace container that holds the template — omit it to use the target container (naming the target file again, relative or absolute, is accepted and means the same thing). Templates may come from another action or section of that container, or from another readable workspace container, which is then read natively and staged alongside the target. Optional fields are typed first-party schema overrides applied atomically; unknown layouts fail closed. Works on loose .tae and on anibnd container sections (the child is rewritten natively, then the container is rebuilt). The Bridge relocates the event table, time table and event group table with rebased references and re-reads the result before commit. Returns exact new addresses, backup, operation and rollback information. '
            + 'Reading order matters: this tool needs TWO delivered reads in the same session process — the target action (any read_tae_events call that delivers its events gives the actionIdentity proof) and the template event (its eventTypeId plus every field you override must have been delivered). Read the target action first, then the template action/event, then call this tool; that order also survives a target action with more events than one read page. A same-container commit only invalidates the read proofs of the section it wrote, so the template proof of another section stays valid.',
        permission: 'commit', permissionLevel: 'commit',
        inputSchema: { file: 'string', events: 'array' },
        run: async (input, context) => {
            const value = asRecord(input);
            if (value.domain && value.domain !== 'tae')
                return fail('DOMAIN_CROSSOVER_REJECTED', 'TAE 新增工具仅接受动作词条：请传 action://c0000/tae/<段>/<动作>/e<下标> 形式的动作地址。');
            const file = asString(value.file);
            if (!file || !Array.isArray(value.events))
                return fail('INVALID_INPUT', 'insert_tae_events 需要 file 和 events 数组。');
            const edit = requireEditSession(context, 'write');
            if (!('session' in edit))
                return edit;
            const resolved = resolveIndexedResourceFile(context, file, 'chr');
            if (!resolved.ok)
                return fail(resolved.code, resolved.message, resolved.details);
            for (const raw of value.events) {
                const template = asRecord(asRecord(raw).template);
                if (typeof template.file === 'string') {
                    const resolvedTemplate = resolveIndexedResourceFile(context, template.file, 'chr');
                    if (!resolvedTemplate.ok)
                        return fail(resolvedTemplate.code, resolvedTemplate.message, resolvedTemplate.details);
                }
            }
            const events = value.events.map(raw => {
                const event = asRecord(raw);
                const template = asRecord(event.template);
                const templateFile = typeof template.file === 'string' ? resolveIndexedResourceFile(context, template.file, 'chr') : undefined;
                return { ...event, template: { ...template, ...(templateFile?.ok ? { file: nativePathFromFileToken(templateFile.path) } : {}) } };
            });
            const result = await insertTaeEvents({ edit: edit.session, file: nativePathFromFileToken(resolved.path), events });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.diagnostics);
            // The full result carries before/after payloads and exceeds the result budget, which used to drop
            // the only thing the caller needs: where the new events landed.
            const inserted = result.after.map((event) => ({ address: event.address, eventTypeId: event.eventTypeId, startFrame: event.startFrame, endFrame: event.endFrame }));
            // Plain strings survive the whitelist projection that trims an oversized body.
            const addresses = result.after.map((event) => event.address);
            // 只让被写入的 TAE 段过期：其它段（例如这一步用到的模板段）的读证明仍成立。
            const writtenSections = [...new Set(result.after.flatMap((event) => {
                    const parsed = parseTaeAddress(event.address);
                    return parsed?.taeEntryIndex === undefined ? [] : [parsed.taeEntryIndex];
                }))];
            return finalizeCommittedToolResult({ data: { ...result, inserted, addresses }, changedSources: [result.filePath], context,
                ...(writtenSections.length === 0
                    ? {}
                    : { invalidateProofScopes: [{ source: result.filePath, matches: taeProofEntryMatcher(writtenSections) }] }),
                verifyNative: async () => result.nativeVerified ? { ok: true, details: { addresses: result.after.map(e => e.address) } }
                    : { ok: false, code: 'TAE_INSERT_READBACK_FAILED', message: '提交后未完整回读新增词条。', details: result.diagnostics } });
        }
    };
}
//# sourceMappingURL=insert_tae_events.js.map