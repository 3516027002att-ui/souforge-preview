/**
 * Writer for container_child_replace — synthetic SFBN BND and DCX(DFLT)+BND only.
 * Explicit writtenTargets; never claims native game BND/DCX authority beyond fixture path.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES, createDiagnostic } from '@soulforge/shared';
import { replaceContainerChildInMemory } from '../containers/containerService.js';
import { decodeStrictBase64, StrictBase64Error } from '../util/base64.js';
import { checkOriginalContentHash, resolveExpectedHash } from '../validators/textHash.js';
import { runBridge } from '../bridge/runBridge.js';
export class ContainerChildReplaceWriter {
    writerId = 'writer:container-child-replace';
    supportedResourceKinds = ['msg', 'param', 'event', 'map', 'other', 'unknown'];
    supportedOperations = ['container_child_replace', 'container_child_add', 'container_child_delete', 'container_child_rename', 'container_child_move'];
    inputSchemaVersion = 'soulforge.containerChildReplace.v1';
    preconditions = [
        'expectedContainerHash',
        'expectedChildHash',
        'confirmation required',
        'authoritative-repack containers only',
        'staging only'
    ];
    canHandle(operation) {
        if (!isContainerChildOperation(operation))
            return false;
        if (isNativeBnd4Operation(operation))
            return true;
        return operation.kind === 'container_child_replace'
            && Boolean(operation.childContentBase64)
            && Boolean(operation.expectedChildHash)
            && Boolean(operation.expectedContainerHash || operation.expectedHash);
    }
    writePlan(patch, operations) {
        const handled = operations.filter((op) => this.canHandle(op));
        return {
            writerId: this.writerId,
            operations: handled,
            stagingRelativePaths: handled.map((op) => stagingRelativeName(op)),
            preconditions: handled.flatMap((op) => op.preconditions),
            estimatedRisk: 'high',
            notes: `ContainerChildReplaceWriter plan for patch ${patch.patchId}`
        };
    }
    async applyToStaging(input) {
        const writtenTargets = [];
        const diagnostics = [];
        for (const op of input.operations) {
            if (!this.canHandle(op) || !isContainerChildOperation(op))
                continue;
            if (!op.targetPath) {
                diagnostics.push(createDiagnostic({
                    severity: 'error',
                    code: 'CONTAINER_WRITER_MISSING_PATH',
                    message: 'ContainerChildReplaceWriter requires targetPath.',
                    targetUri: op.targetUri
                }));
                continue;
            }
            const hashCheck = await checkOriginalContentHash(op, 'apply_to_staging');
            diagnostics.push(...hashCheck);
            if (hashCheck.some((d) => d.severity === 'error'))
                continue;
            if (isNativeBnd4Operation(op)) {
                const stagingPath = join(input.stagingRoot, stagingRelativeName(op));
                await mkdir(dirname(stagingPath), { recursive: true });
                const bridgeResult = await runBridge({
                    command: 'write-bnd4',
                    filePath: op.targetPath,
                    resourceUri: op.targetUri,
                    allowedRoots: [input.workspaceRoot ?? dirname(op.targetPath), input.stagingRoot],
                    writableRoots: [input.stagingRoot],
                    workspaceSessionId: `writer-${op.id}`,
                    timeoutMs: 120_000,
                    commandOptions: nativeBnd4Options(op, stagingPath),
                    ...(input.oodleRuntimeRoot ? { oodleRuntimeRoot: input.oodleRuntimeRoot } : {})
                });
                diagnostics.push(...bridgeResult.diagnostics.map((diagnostic) => createDiagnostic({
                    severity: diagnostic.severity,
                    code: diagnostic.code,
                    message: diagnostic.message,
                    targetUri: op.targetUri,
                    ...(diagnostic.details === undefined ? {} : { details: diagnostic.details })
                })));
                if (bridgeResult.parseStatus === 'failed'
                    || !bridgeResult.diagnostics.some((diagnostic) => diagnostic.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.bnd4)) {
                    continue;
                }
                writtenTargets.push({ opId: op.id, targetUri: op.targetUri, targetPath: op.targetPath, stagingPath });
                continue;
            }
            if (op.kind !== 'container_child_replace')
                continue;
            let original;
            try {
                original = await readFile(op.targetPath);
            }
            catch (error) {
                diagnostics.push(createDiagnostic({
                    severity: 'error',
                    code: 'CONTAINER_WRITER_READ_FAILED',
                    message: error instanceof Error ? error.message : 'Failed to read container.',
                    targetUri: op.targetUri
                }));
                continue;
            }
            const expectedContainerHash = op.expectedContainerHash ?? resolveExpectedHash(op) ?? '';
            const expectedChildHash = op.expectedChildHash ?? '';
            const childSelector = op.childPath
                || (op.childUri ? decodeChildName(op.childUri) : '');
            let newChild;
            try {
                newChild = decodeStrictBase64(op.childContentBase64 ?? '', { allowEmpty: false });
            }
            catch (error) {
                diagnostics.push(createDiagnostic({
                    severity: 'error',
                    code: error instanceof StrictBase64Error ? error.code : 'CONTAINER_CHILD_PAYLOAD_INVALID',
                    message: error instanceof Error ? error.message : 'Invalid childContentBase64.',
                    targetUri: op.targetUri
                }));
                continue;
            }
            const replaced = replaceContainerChildInMemory(original, childSelector, newChild, expectedContainerHash, expectedChildHash);
            diagnostics.push(...replaced.diagnostics);
            if (!replaced.ok || !replaced.containerBytes)
                continue;
            const stagingPath = join(input.stagingRoot, stagingRelativeName(op));
            await mkdir(dirname(stagingPath), { recursive: true });
            await writeFile(stagingPath, replaced.containerBytes);
            writtenTargets.push({
                opId: op.id,
                targetUri: op.targetUri,
                targetPath: op.targetPath,
                stagingPath
            });
        }
        return {
            ok: diagnostics.every((item) => item.severity !== 'error') && writtenTargets.length > 0,
            writtenTargets,
            writtenPaths: writtenTargets.map((item) => item.stagingPath),
            diagnostics,
            rollback: this.produceRollbackMetadata({ operations: input.operations, backupPaths: [] })
        };
    }
    produceRollbackMetadata(input) {
        return {
            writerId: this.writerId,
            strategy: 'restore_backup',
            backupPaths: input.backupPaths,
            notes: `Container child replace rollback for ${input.operations.length} op(s)`
        };
    }
}
function isContainerChildOperation(operation) {
    return operation.kind.startsWith('container_child_');
}
function isNativeBnd4Operation(operation) {
    return operation.kind.startsWith('container_child_')
        && (operation.containerFormat === 'BND4_DFLT' || operation.containerFormat === 'BND4_KRAK')
        && operation.metadata?.nativeFormatAuthority === true
        && Boolean(operation.targetPath)
        && Boolean(operation.expectedContainerHash ?? operation.expectedHash);
}
function nativeBnd4Options(op, outputPath) {
    const mutation = op.kind.slice('container_child_'.length);
    const common = {
        outputPath,
        mutation,
        expectedContainerHash: op.expectedContainerHash ?? op.expectedHash,
        ...(op.expectedChildHash ? { expectedChildHash: op.expectedChildHash } : {}),
        ...(typeof op.metadata?.nativeEntryIndex === 'number' ? { entryIndex: op.metadata.nativeEntryIndex } : {}),
        ...(op.childPath ? { childPath: op.childPath } : {})
    };
    if (mutation === 'replace' || mutation === 'add') {
        common.contentBase64 = op.childContentBase64;
    }
    if (mutation === 'add') {
        common.name = op.newChildPath ?? op.childPath;
        common.id = op.metadata?.nativeEntryId;
        if (typeof op.metadata?.nativeEntryFlags === 'number')
            common.flags = op.metadata.nativeEntryFlags;
        if (typeof op.metadata?.nativeEntryUnknown === 'number')
            common.unknown = op.metadata.nativeEntryUnknown;
    }
    if (mutation === 'rename')
        common.newName = op.newChildPath;
    if (mutation === 'move')
        common.toIndex = op.metadata?.toIndex;
    return common;
}
function decodeChildName(childUri) {
    const hash = childUri.indexOf('#');
    const fragment = hash >= 0 ? childUri.slice(hash + 1) : childUri;
    const parts = fragment.split('/').filter(Boolean);
    const idx = parts.lastIndexOf('child');
    const raw = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
    return decodeURIComponent(raw ?? '');
}
function stagingRelativeName(op) {
    const safe = op.targetUri.replace(/[^a-zA-Z0-9._-]/g, '_');
    const base = op.targetPath?.split(/[/\\]/).pop() ?? 'container.bin';
    return join(safe, op.id.slice(0, 8), base);
}
//# sourceMappingURL=containerChildReplaceWriter.js.map