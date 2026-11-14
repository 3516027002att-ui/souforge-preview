/**
 * Content-addressed staging area scaffold.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
export async function createContentAddressedStaging(baseDir) {
    const root = await mkdtemp(join(baseDir ?? tmpdir(), 'soulforge-staging-'));
    await mkdir(join(root, 'objects'), { recursive: true });
    await mkdir(join(root, 'work'), { recursive: true });
    return {
        stagingId: randomUUID(),
        root,
        blobs: new Map()
    };
}
export async function stageBytes(staging, bytes) {
    const buffer = Buffer.from(bytes);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const absolutePath = join(staging.root, 'objects', hash);
    if (!staging.blobs.has(hash)) {
        await writeFile(absolutePath, buffer);
        const blob = { hash, absolutePath, byteLength: buffer.byteLength };
        staging.blobs.set(hash, blob);
        return blob;
    }
    return staging.blobs.get(hash);
}
export async function stageFile(staging, sourcePath) {
    const bytes = await readFile(sourcePath);
    return stageBytes(staging, bytes);
}
export async function materializeBlob(staging, hash, destinationRelativePath) {
    const blob = staging.blobs.get(hash);
    if (!blob)
        throw new Error(`Unknown staging blob: ${hash}`);
    const destination = join(staging.root, 'work', destinationRelativePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(blob.absolutePath, destination);
    return destination;
}
export function stagingWorkRoot(staging) {
    return join(staging.root, 'work');
}
//# sourceMappingURL=contentAddressedStaging.js.map