/**
 * Backup / restore-point scaffold.
 */
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
export async function createRestorePoint(input) {
    const baseDir = input.baseDir ?? tmpdir();
    await mkdir(baseDir, { recursive: true });
    const root = await mkdtemp(join(baseDir, 'soulforge-backup-'));
    const files = [];
    for (const sourcePath of input.sourcePaths) {
        const bytes = await readFile(sourcePath);
        const beforeHash = createHash('sha256').update(bytes).digest('hex');
        const backupPath = join(root, 'files', safeName(sourcePath), basename(sourcePath));
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(sourcePath, backupPath);
        files.push({ sourcePath, backupPath, beforeHash, sizeBytes: bytes.byteLength });
    }
    const restorePoint = {
        restorePointId: randomUUID(),
        root,
        createdAt: new Date().toISOString(),
        files,
        sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
        metadataPath: join(root, 'restore-point.json')
    };
    await writeFile(restorePoint.metadataPath, `${JSON.stringify({
        restorePointId: restorePoint.restorePointId,
        createdAt: restorePoint.createdAt,
        label: input.label ?? null,
        sizeBytes: restorePoint.sizeBytes,
        files: restorePoint.files
    }, null, 2)}\n`, 'utf8');
    return restorePoint;
}
export async function restoreFromPoint(restorePoint) {
    const restoredPaths = [];
    const errors = [];
    for (const file of restorePoint.files) {
        try {
            await mkdir(dirname(file.sourcePath), { recursive: true });
            await copyFile(file.backupPath, file.sourcePath);
            restoredPaths.push(file.sourcePath);
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return { ok: errors.length === 0, restoredPaths, errors };
}
function safeName(pathValue) {
    return pathValue.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}
//# sourceMappingURL=restorePoint.js.map