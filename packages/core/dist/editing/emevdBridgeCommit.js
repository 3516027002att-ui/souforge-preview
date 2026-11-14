/**
 * Map EMEVD editor mutations → Bridge write-emevd staging commands.
 * Does not bypass Patch Engine: callers must commit staged bytes via PatchIR.
 */
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
/**
 * Write a single EMEVD mutation into a staging path via Bridge (production authority).
 */
export async function commitEmevdMutationViaBridge(request) {
    const commandOptions = buildCommandOptions(request);
    return runEmevdWriteCommand({
        sourcePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        ...(request.oodleRuntimeRoot !== undefined ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
        commandOptions
    });
}
/**
 * Apply an ordered batch of EMEVD mutations via Bridge in one staging write.
 * The C# writer re-reads the staged output and verifies every mutation before
 * reporting EMEVD_STAGING_WRITE_VERIFIED.
 */
export async function commitEmevdBatchViaBridge(request) {
    const commandOptions = {
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        mutations: request.mutations.map((m) => buildMutationPayload(m))
    };
    return runEmevdWriteCommand({
        sourcePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
        ...(request.oodleRuntimeRoot !== undefined ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
        commandOptions
    });
}
async function runEmevdWriteCommand(input) {
    const result = await runBridge({
        command: 'write-emevd',
        filePath: input.sourcePath,
        allowedRoots: input.allowedRoots,
        writableRoots: input.writableRoots,
        timeoutMs: input.timeoutMs ?? 120_000,
        ...(input.oodleRuntimeRoot !== undefined ? { oodleRuntimeRoot: input.oodleRuntimeRoot } : {}),
        commandOptions: input.commandOptions
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.emevd);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.sourceFormat === 'dcx' || result.data?.sourceFormat === 'emevd'
            ? { sourceFormat: result.data.sourceFormat }
            : {}),
        ...(result.data?.outerFileHash ? { outerFileHash: result.data.outerFileHash } : {}),
        ...(result.data?.payloadHash ? { payloadHash: result.data.payloadHash } : {}),
        ...(result.data?.eventCount !== undefined ? { eventCount: result.data.eventCount } : {}),
        ...(result.data?.instructionCount !== undefined
            ? { instructionCount: result.data.instructionCount }
            : {}),
        ...(result.data?.mutationCount !== undefined ? { mutationCount: result.data.mutationCount } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
function buildCommandOptions(request) {
    return {
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        ...buildMutationPayload(request.mutation, request.instructionIndex)
    };
}
/** Map an editor/native mutation shape to Bridge write-emevd options. */
function buildMutationPayload(m, instructionIndex) {
    if ('kind' in m && m.kind === 'emevd_set_rest_behavior') {
        const eventId = parseEventIdFromUri(m.eventUri);
        return {
            mutation: 'set_rest_behavior',
            eventId,
            restBehavior: m.restBehavior
        };
    }
    if ('kind' in m && m.kind === 'emevd_update_id') {
        const eventId = parseEventIdFromUri(m.eventUri);
        return {
            mutation: 'update_id',
            eventId,
            newEventId: m.newEventId
        };
    }
    if ('kind' in m && m.kind === 'emevd_set_instruction_args') {
        if (instructionIndex === undefined) {
            throw new Error('EMEVD_INSTRUCTION_INDEX_REQUIRED');
        }
        return {
            mutation: 'set_instruction_args',
            instructionIndex,
            argsBase64: m.argsBase64
        };
    }
    if ('kind' in m && m.kind === 'set_rest_behavior' && 'eventId' in m) {
        return {
            mutation: 'set_rest_behavior',
            eventId: m.eventId,
            restBehavior: m.restBehavior
        };
    }
    if ('kind' in m && m.kind === 'update_id' && 'eventId' in m && 'newEventId' in m) {
        return {
            mutation: 'update_id',
            eventId: m.eventId,
            newEventId: m.newEventId
        };
    }
    if ('kind' in m && m.kind === 'add_event') {
        return {
            mutation: 'add_event',
            newEventId: m.newEventId,
            ...(m.restBehavior !== undefined ? { restBehavior: m.restBehavior } : {})
        };
    }
    if ('kind' in m && m.kind === 'delete_event') {
        return { mutation: 'delete_event', eventId: m.eventId };
    }
    if ('kind' in m && m.kind === 'duplicate_event') {
        return {
            mutation: 'duplicate_event',
            eventId: m.eventId,
            newEventId: m.newEventId
        };
    }
    if ('kind' in m && m.kind === 'set_instruction_args' && 'instructionIndex' in m) {
        return {
            mutation: 'set_instruction_args',
            instructionIndex: m.instructionIndex,
            argsBase64: m.argsBase64,
            ...(m.eventId !== undefined ? { eventId: m.eventId } : {})
        };
    }
    if ('kind' in m && m.kind === 'set_event_parameters') {
        return {
            mutation: 'set_event_parameters',
            eventId: m.eventId,
            parameters: m.parameters
        };
    }
    if ('kind' in m && m.kind === 'insert_instruction') {
        return {
            mutation: 'insert_instruction',
            eventId: m.eventId,
            instructionIndex: m.instructionIndex,
            bank: m.bank,
            id: m.id,
            argsBase64: m.argsBase64
        };
    }
    if ('kind' in m && m.kind === 'delete_instruction') {
        return {
            mutation: 'delete_instruction',
            eventId: m.eventId,
            instructionIndex: m.instructionIndex
        };
    }
    throw new Error(`EMEVD_BRIDGE_MUTATION_UNSUPPORTED: ${m.kind}`);
}
function parseEventIdFromUri(eventUri) {
    const match = /#event\/(-?\d+)/.exec(eventUri);
    if (!match)
        throw new Error(`EMEVD_EVENT_URI_INVALID: ${eventUri}`);
    return Number(match[1]);
}
//# sourceMappingURL=emevdBridgeCommit.js.map