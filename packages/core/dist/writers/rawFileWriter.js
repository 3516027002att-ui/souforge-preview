import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createDiagnostic } from '@soulforge/shared';
import { decodeStrictBase64, StrictBase64Error } from '../util/base64.js';
export class RawFileWriter {
    writerId = 'writer:raw-file';
    supportedResourceKinds = ['other', 'unknown', 'obj', 'chr', 'sfx'];
    supportedOperations = ['raw_byte_range_edit', 'file_replace'];
    inputSchemaVersion = 'soulforge.rawByteRangeEdit.v1';
    preconditions = [
        'content hash precondition required',
        'staging only',
        'commit owned by WorkspaceTransaction'
    ];
    canHandle(operation) {
        return operation.kind === 'raw_byte_range_edit'
            || (operation.kind === 'file_replace' && operation.newContentBase64 !== undefined);
    }
    writePlan(patch, operations) {
        const handled = operations.filter((op) => this.canHandle(op));
        return {
            writerId: this.writerId,
            operations: handled,
            stagingRelativePaths: handled.map((op) => stagingRelativeName(op)),
            preconditions: handled.flatMap((op) => op.preconditions),
            estimatedRisk: 'caution',
            notes: `RawFileWriter plan for patch ${patch.patchId}`
        };
    }
    async applyToStaging(input) {
        const writtenTargets = [];
        const diagnostics = [];
        for (const op of input.operations) {
            if (!this.canHandle(op))
                continue;
            if (!op.targetPath) {
                diagnostics.push(createDiagnostic({
                    severity: 'error',
                    code: 'RAW_WRITER_MISSING_PATH',
                    message: 'RawFileWriter requires targetPath.',
                    targetUri: op.targetUri
                }));
                continue;
            }
            let original;
            try {
                original = await readFile(op.targetPath);
            }
            catch (error) {
                diagnostics.push(createDiagnostic({
                    severity: 'error',
                    code: 'RAW_WRITER_READ_FAILED',
                    message: error instanceof Error ? error.message : 'Failed to read target for raw edit.',
                    targetUri: op.targetUri
                }));
                continue;
            }
            if (op.kind === 'raw_byte_range_edit') {
                const hash = sha256(original);
                if (hash !== op.expectedHash) {
                    diagnostics.push(createDiagnostic({
                        severity: 'error',
                        code: 'HASH_MISMATCH',
                        message: 'Raw edit content hash precondition failed.',
                        targetUri: op.targetUri,
                        details: { expected: op.expectedHash, actual: hash }
                    }));
                    continue;
                }
                if (op.offset + op.length > original.length) {
                    diagnostics.push(createDiagnostic({
                        severity: 'error',
                        code: 'RAW_EDIT_RANGE_OOB',
                        message: 'Raw byte range exceeds file length.',
                        targetUri: op.targetUri,
                        details: { offset: op.offset, length: op.length, fileLength: original.length }
                    }));
                    continue;
                }
                let replacement;
                try {
                    replacement = decodeStrictBase64(op.replacementBase64, { allowEmpty: false });
                }
                catch (error) {
                    diagnostics.push(createDiagnostic({
                        severity: 'error',
                        code: error instanceof StrictBase64Error ? error.code : 'RAW_EDIT_PAYLOAD_INVALID',
                        message: error instanceof Error ? error.message : 'replacementBase64 is not valid strict base64.',
                        targetUri: op.targetUri
                    }));
                    continue;
                }
                const next = Buffer.concat([
                    original.subarray(0, op.offset),
                    replacement,
                    original.subarray(op.offset + op.length)
                ]);
                const stagingPath = join(input.stagingRoot, stagingRelativeName(op));
                await mkdir(dirname(stagingPath), { recursive: true });
                await writeFile(stagingPath, next);
                writtenTargets.push({
                    opId: op.id,
                    targetUri: op.targetUri,
                    targetPath: op.targetPath,
                    stagingPath
                });
            }
            else if (op.kind === 'file_replace' && op.newContentBase64 !== undefined) {
                let next;
                try {
                    next = decodeStrictBase64(op.newContentBase64, { allowEmpty: op.allowEmpty === true });
                }
                catch (error) {
                    diagnostics.push(createDiagnostic({
                        severity: 'error',
                        code: error instanceof StrictBase64Error ? error.code : 'FILE_REPLACE_PAYLOAD_INVALID',
                        message: error instanceof Error ? error.message : 'newContentBase64 is not valid strict base64.',
                        targetUri: op.targetUri
                    }));
                    continue;
                }
                const stagingPath = join(input.stagingRoot, stagingRelativeName(op));
                await mkdir(dirname(stagingPath), { recursive: true });
                await writeFile(stagingPath, next);
                writtenTargets.push({
                    opId: op.id,
                    targetUri: op.targetUri,
                    targetPath: op.targetPath,
                    stagingPath
                });
            }
        }
        return {
            ok: diagnostics.every((item) => item.severity !== 'error'),
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
            notes: `Raw rollback for ${input.operations.length} op(s)`
        };
    }
}
function sha256(buf) {
    return createHash('sha256').update(buf).digest('hex');
}
function stagingRelativeName(op) {
    const safe = op.targetUri.replace(/[^a-zA-Z0-9._-]/g, '_');
    const base = op.targetPath?.split(/[/\\]/).pop() ?? 'file.bin';
    return join(safe, op.id.slice(0, 8), base);
}
//# sourceMappingURL=rawFileWriter.js.map