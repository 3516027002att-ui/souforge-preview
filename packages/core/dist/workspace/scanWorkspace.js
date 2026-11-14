import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { detectResourceFileType } from './resourceFileTypes.js';
import { ALL_RESOURCE_KINDS, classifyResourceKind, detectArtifactMarkers, KNOWN_RESOURCE_DIRS } from './resourceKinds.js';
import { makeFileResourceUri, makeStableFileId, makeWorkspaceId, makeWorkspaceRelativePath, toPosixPath } from './resourceUri.js';
export async function scanWorkspace(options) {
    const workspaceRoot = options.workspaceRoot;
    const diagnostics = [];
    const files = [];
    throwIfAborted(options.signal);
    let workspaceId;
    try {
        // Match the opened session's physical identity without changing the
        // selected path namespace used for file locations and relative paths.
        workspaceId = makeWorkspaceId(await realpath(workspaceRoot));
    }
    catch (error) {
        return {
            workspaceId: makeWorkspaceId(workspaceRoot),
            workspaceRoot,
            files,
            diagnostics: [{
                    severity: 'error',
                    code: 'WORKSPACE_ROOT_NOT_DIRECTORY',
                    message: 'Workspace root is not a readable directory.',
                    details: { workspaceRoot, cause: error instanceof Error ? error.message : String(error) }
                }],
            countsByKind: countByKind(files)
        };
    }
    throwIfAborted(options.signal);
    if (options.includeKinds && options.includeKinds.length > 0) {
        await scanKnownResourceDirectories(options, workspaceRoot, workspaceId, files, diagnostics);
    }
    else {
        await scanWholeWorkspace(options, workspaceRoot, workspaceId, files, diagnostics);
    }
    return {
        workspaceId,
        workspaceRoot,
        files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        diagnostics,
        countsByKind: countByKind(files)
    };
}
async function scanKnownResourceDirectories(options, workspaceRoot, workspaceId, files, diagnostics) {
    const includeKinds = new Set(options.includeKinds ?? KNOWN_RESOURCE_DIRS);
    for (const kind of includeKinds) {
        throwIfAborted(options.signal);
        const directoryPath = join(workspaceRoot, kind);
        if (!(await pathIsDirectory(directoryPath))) {
            diagnostics.push({
                severity: 'info',
                code: 'RESOURCE_DIR_MISSING',
                message: `Resource directory '${kind}' does not exist in this workspace.`,
                details: { kind, directoryPath }
            });
            continue;
        }
        await walkDirectory(directoryPath, diagnostics, async (absolutePath) => {
            await addIndexedFile(options, workspaceRoot, workspaceId, absolutePath, files, diagnostics);
        }, options.signal);
    }
}
async function scanWholeWorkspace(options, workspaceRoot, workspaceId, files, diagnostics) {
    if (!(await pathIsDirectory(workspaceRoot))) {
        diagnostics.push({
            severity: 'error',
            code: 'WORKSPACE_ROOT_NOT_DIRECTORY',
            message: 'Workspace root is not a readable directory.',
            details: { workspaceRoot }
        });
        return;
    }
    await walkDirectory(workspaceRoot, diagnostics, async (absolutePath) => {
        await addIndexedFile(options, workspaceRoot, workspaceId, absolutePath, files, diagnostics);
    }, options.signal);
}
async function addIndexedFile(options, workspaceRoot, workspaceId, absolutePath, files, diagnostics) {
    throwIfAborted(options.signal);
    let fileStat;
    try {
        fileStat = await stat(absolutePath);
    }
    catch (error) {
        diagnostics.push({
            severity: 'warning',
            code: 'FILE_STAT_FAILED',
            message: error instanceof Error ? error.message : 'Failed to stat file during workspace scan.',
            details: { absolutePath }
        });
        return;
    }
    if (!fileStat.isFile())
        return;
    const relativePath = makeWorkspaceRelativePath(workspaceRoot, absolutePath);
    const resourceKind = classifyResourceKind(relativePath);
    const fileType = detectResourceFileType(relativePath);
    const sourceUri = makeFileResourceUri(relativePath);
    // CAT-05：只附加 artifact/source variant 基础标记，不改变物理 ResourceKind。
    // scanWorkspace 只扫 overlay 层（base 由调用方挂载后另行提供），因此
    // sourceLayer 恒为 'overlay'。
    const artifactMarkers = detectArtifactMarkers({ relativePath, sourceLayer: 'overlay' });
    let sha256;
    let fileDiagnostics = [];
    if (options.includeContentHashes !== false) {
        try {
            sha256 = await sha256File(absolutePath, options.signal);
        }
        catch (error) {
            if (options.signal?.aborted)
                throw error;
            const diag = {
                severity: 'warning',
                code: 'FILE_HASH_FAILED',
                message: error instanceof Error ? error.message : 'Failed to hash file during workspace scan.',
                details: { absolutePath }
            };
            diagnostics.push(diag);
            fileDiagnostics = [diag];
        }
    }
    files.push({
        id: makeStableFileId(workspaceId, relativePath),
        workspaceId,
        sourceUri,
        sourcePath: absolutePath,
        absolutePath,
        relativePath,
        game: options.game ?? 'unknown',
        resourceKind,
        extension: fileType.extension,
        compoundExtension: fileType.compoundExtension,
        formatKind: fileType.formatKind,
        formatLabel: fileType.formatLabel,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        ...(sha256 ? { sha256 } : {}),
        parseStatus: 'unparsed',
        diagnostics: fileDiagnostics,
        ...(artifactMarkers ? { artifactMarkers } : {})
    });
    options.onProgress?.({ scannedFiles: files.length, currentPath: toPosixPath(relativePath) });
}
async function sha256File(filePath, signal) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath, { signal })) {
        throwIfAborted(signal);
        hash.update(chunk);
    }
    return hash.digest('hex');
}
async function walkDirectory(directoryPath, diagnostics, onFile, signal) {
    let entries;
    try {
        entries = await readdir(directoryPath, { withFileTypes: true });
    }
    catch (error) {
        diagnostics.push({
            severity: 'warning',
            code: 'DIRECTORY_READ_FAILED',
            message: error instanceof Error ? error.message : 'Failed to read directory during workspace scan.',
            details: { directoryPath }
        });
        return;
    }
    for (const entry of entries) {
        throwIfAborted(signal);
        const absolutePath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name.toLowerCase() === '$recycle.bin') {
                continue;
            }
            await walkDirectory(absolutePath, diagnostics, onFile, signal);
            continue;
        }
        if (entry.isFile()) {
            await onFile(absolutePath);
        }
    }
}
async function pathIsDirectory(pathValue) {
    try {
        return (await stat(pathValue)).isDirectory();
    }
    catch {
        return false;
    }
}
function countByKind(files) {
    const counts = Object.fromEntries(ALL_RESOURCE_KINDS.map((kind) => [kind, 0]));
    for (const file of files) {
        counts[file.resourceKind] += 1;
    }
    return counts;
}
function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new Error('Workspace scan aborted.');
    }
}
//# sourceMappingURL=scanWorkspace.js.map