/**
 * Map Bridge EMEVD envelope (renderer-safe subset) into EmevdEditorDocument.
 * Instruction sample is capped by Bridge; full bank is not required for four-view skeleton.
 */
import { attachEmevdStableIdentity } from '../emevd/stableIdentity.js';
export function emevdEnvelopeToEditorDocument(resourceUri, envelope, options) {
    const maxEvents = options?.maxEvents ?? 256;
    const sampleByIndex = new Map((envelope.instructionsSample ?? []).map((item) => [item.index, item]));
    const events = (envelope.events ?? []).slice(0, maxEvents).map((event) => {
        const eventUri = `${resourceUri}#event/${event.id}`;
        const start = event.instructionStartIndex ?? -1;
        const count = event.instructionCount ?? 0;
        const instructions = [];
        if (start >= 0 && count > 0) {
            for (let i = 0; i < Math.min(count, 64); i += 1) {
                const globalIndex = start + i;
                const sample = sampleByIndex.get(globalIndex);
                instructions.push({
                    instructionUri: `${eventUri}/instr/${i}`,
                    bank: sample?.bank ?? 0,
                    id: sample?.id ?? 0,
                    argsBase64: sample?.argsBase64 ?? '',
                    unknown: !sample
                });
            }
        }
        return {
            eventUri,
            eventId: event.id,
            restBehavior: event.restBehavior ?? 0,
            layer: event.layer ?? -1,
            instructions,
            ...(event.parameters ? { parameters: event.parameters } : {})
        };
    });
    const diagnostics = [];
    if ((envelope.eventCount ?? 0) > maxEvents) {
        diagnostics.push({
            severity: 'info',
            code: 'EMEVD_EDITOR_EVENTS_TRUNCATED',
            message: `编辑器仅加载前 ${maxEvents} 个事件（共 ${envelope.eventCount}）。`
        });
    }
    if (envelope.authority) {
        diagnostics.push({
            severity: 'info',
            code: 'EMEVD_AUTHORITY',
            message: `Bridge authority=${envelope.authority}`
        });
    }
    return attachEmevdStableIdentity({
        schemaVersion: 1,
        resourceUri,
        revision: 0,
        events,
        bytesBase64: options?.bytesBase64 ?? '',
        diagnostics
    }, options?.documentInstanceId !== undefined
        ? { documentInstanceId: options.documentInstanceId }
        : undefined);
}
//# sourceMappingURL=emevdEnvelopeToDocument.js.map