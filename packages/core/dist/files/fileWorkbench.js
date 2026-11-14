/**
 * Full File Workbench facade for Files Mode.
 */
import { access, constants } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createResourceUri, formatResourceUri } from '@soulforge/shared';
import { getFileCapabilities } from './fileCapabilities.js';
import { previewFileResource } from './filePreview.js';
import { readFileResource } from './readFileResource.js';
import { commitFilePatch, proposeRawByteEdit, proposeStructuredEditBlocked, proposeTextFileEdit, proposeWholeFileReplace } from './writeFileResource.js';
import { rollbackOperation } from '../patch/rollback.js';
function resolvePaths(input) {
    if (input.absolutePath) {
        const absolutePath = resolve(input.absolutePath);
        const relativePath = (input.relativePath
            ?? relative(input.session.layers.overlayRoot, absolutePath)).replaceAll('\\', '/');
        return { absolutePath, relativePath };
    }
    if (!input.relativePath) {
        throw new Error('openFileResource requires absolutePath or relativePath');
    }
    const relativePath = input.relativePath.replaceAll('\\', '/');
    return {
        absolutePath: input.session.toOverlayPath(relativePath),
        relativePath
    };
}
export async function openFileResource(input) {
    const { absolutePath, relativePath } = resolvePaths({
        session: input.session,
        ...(input.absolutePath ? { absolutePath: input.absolutePath } : {}),
        ...(input.relativePath ? { relativePath: input.relativePath } : {})
    });
    let exists = true;
    try {
        await access(absolutePath, constants.F_OK);
    }
    catch {
        exists = false;
    }
    const capabilities = getFileCapabilities({ absolutePath, relativePath });
    const diagnostics = [];
    if (!exists) {
        diagnostics.push({
            severity: 'error',
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${relativePath}`,
            sourceUri: `file://${relativePath}`
        });
    }
    const preview = exists
        ? await previewFileResource({ absolutePath, relativePath })
        : {
            absolutePath,
            relativePath,
            size: 0,
            bytesRead: 0,
            truncated: false,
            previewKind: 'empty',
            capabilities,
            diagnostics: [],
            nativeFormatAuthority: false
        };
    const resourceUri = formatResourceUri(createResourceUri({
        game: input.game ?? input.session.meta.game,
        overlay: input.session.isBasePath(absolutePath) ? 'base' : 'overlay',
        physicalPath: relativePath,
        resourceKind: capabilities.resourceKind
    }));
    return {
        absolutePath,
        relativePath,
        resourceUri,
        exists,
        capabilities,
        preview,
        diagnostics: [
            ...diagnostics,
            ...preview.diagnostics.map((d) => {
                const item = {
                    severity: d.severity,
                    code: String(d.code),
                    message: d.message,
                    sourceUri: d.targetUri ?? resourceUri
                };
                if (d.details !== undefined)
                    item.details = d.details;
                return item;
            })
        ],
        nativeFormatAuthority: false
    };
}
export async function getFileCapabilitiesForPath(input) {
    const paths = resolvePaths({
        session: input.session,
        ...(input.absolutePath ? { absolutePath: input.absolutePath } : {}),
        ...(input.relativePath ? { relativePath: input.relativePath } : {})
    });
    return getFileCapabilities(paths);
}
export { readFileResource, previewFileResource, proposeTextFileEdit, proposeRawByteEdit, proposeWholeFileReplace, proposeStructuredEditBlocked, commitFilePatch };
export async function rollbackFileOperation(input) {
    return rollbackOperation({
        opId: input.opId,
        store: input.store,
        ...(input.session ? { session: input.session } : {}),
        ...(input.confirmation ? { confirmation: input.confirmation } : {})
    });
}
export async function commitProposedFileWrite(input) {
    if (input.proposal.diagnostics.some((d) => d.severity === 'error')) {
        return {
            opId: input.proposal.patch.patchId,
            backupRoot: '',
            changedFiles: [],
            diagnostics: input.proposal.diagnostics.map((d) => {
                const item = {
                    severity: d.severity,
                    code: String(d.code),
                    message: d.message
                };
                if (d.targetUri !== undefined)
                    item.sourceUri = d.targetUri;
                if (d.details !== undefined)
                    item.details = d.details;
                return item;
            })
        };
    }
    return commitFilePatch({
        patch: input.proposal.patch,
        ...(input.session ? { session: input.session } : {}),
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
        ...(input.operationLog ? { operationLog: input.operationLog } : {}),
        ...(input.confirmation ? { confirmation: input.confirmation } : {}),
        ...(input.backupBaseDir ? { backupBaseDir: input.backupBaseDir } : {}),
        ...(input.recoveryDir ? { recoveryDir: input.recoveryDir } : {})
    });
}
//# sourceMappingURL=fileWorkbench.js.map