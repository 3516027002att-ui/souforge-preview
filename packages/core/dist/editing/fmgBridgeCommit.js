/**
 * FMG Bridge stage helpers — writers only touch staging; callers commit via Patch Engine.
 */
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
export async function commitFmgMutationViaBridge(request) {
    return commitFmgMutationsViaBridge({
        sourcePath: request.sourcePath,
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        mutations: [request.mutation],
        ...(request.entryIndex !== undefined ? { entryIndex: request.entryIndex } : {}),
        ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {})
    });
}
/** Batch upsert/delete/add. C# writer already accepts `mutations[]`. */
export async function commitFmgMutationsViaBridge(request) {
    if (request.mutations.length === 0) {
        return {
            ok: false,
            diagnostics: [{
                    severity: 'error',
                    code: 'FMG_MUTATION_EMPTY',
                    message: 'write-fmg 需要至少一条 mutation。'
                }]
        };
    }
    const commandOptions = {
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        mutations: request.mutations.map((mutation) => (mutation.kind === 'delete'
            ? { kind: 'delete', id: mutation.id, ...(mutation.slotIndex !== undefined ? { slotIndex: mutation.slotIndex } : {}) }
            : { kind: mutation.kind, id: mutation.id, text: mutation.text, ...(mutation.slotIndex !== undefined ? { slotIndex: mutation.slotIndex } : {}) }))
    };
    if (request.entryIndex !== undefined) {
        commandOptions.entryIndex = request.entryIndex;
    }
    if (request.disallowAmbiguous !== undefined) {
        commandOptions.disallowAmbiguous = request.disallowAmbiguous;
    }
    const result = await runBridge({
        command: 'write-fmg',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        timeoutMs: request.timeoutMs ?? 60_000,
        ...(request.oodleRuntimeRoot ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
        commandOptions
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.fmg);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.entryCount !== undefined ? { entryCount: result.data.entryCount } : {}),
        ...(result.data?.storageProfile ? { storageProfile: result.data.storageProfile } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
export async function commitFmgMultiTableViaBridge(request) {
    if (request.tables.length === 0) {
        return {
            ok: false,
            diagnostics: [{
                    severity: 'error',
                    code: 'FMG_TABLES_EMPTY',
                    message: 'write-fmg 需要至少一张表。'
                }]
        };
    }
    const commandOptions = {
        outputPath: request.outputPath,
        expectedDocumentHash: request.expectedDocumentHash,
        ...(request.disallowAmbiguous !== undefined ? { disallowAmbiguous: request.disallowAmbiguous } : {}),
        tables: request.tables.map((table) => ({
            entryIndex: table.entryIndex,
            mutations: table.mutations.map((mutation) => (mutation.kind === 'delete'
                ? { kind: 'delete', id: mutation.id, ...(mutation.slotIndex !== undefined ? { slotIndex: mutation.slotIndex } : {}) }
                : { kind: mutation.kind, id: mutation.id, text: mutation.text, ...(mutation.slotIndex !== undefined ? { slotIndex: mutation.slotIndex } : {}) }))
        }))
    };
    const result = await runBridge({
        command: 'write-fmg',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        timeoutMs: request.timeoutMs ?? 60_000,
        ...(request.oodleRuntimeRoot ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
        commandOptions
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.fmg);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.entryCount !== undefined ? { entryCount: result.data.entryCount } : {}),
        ...(result.data?.tableCount !== undefined ? { tableCount: result.data.tableCount } : {}),
        ...(result.data?.storageProfile ? { storageProfile: result.data.storageProfile } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
export async function readFmgDocumentViaBridge(input) {
    const result = await runBridge({
        command: 'read-fmg-document',
        filePath: input.sourcePath,
        allowedRoots: input.allowedRoots,
        timeoutMs: input.timeoutMs ?? 60_000
    });
    if (result.parseStatus === 'failed' || !result.data?.sourceHash) {
        return {
            ok: false,
            diagnostics: result.diagnostics.map((d) => ({
                severity: d.severity,
                code: d.code,
                message: d.message
            }))
        };
    }
    return {
        ok: true,
        data: {
            sourceHash: result.data.sourceHash,
            entryCount: result.data.entryCount ?? result.data.entries?.length ?? 0,
            entries: (result.data.entries ?? []).map((e) => ({ id: e.id, text: e.text })),
            ...(result.data.authority ? { authority: result.data.authority } : {})
        },
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message
        }))
    };
}
//# sourceMappingURL=fmgBridgeCommit.js.map