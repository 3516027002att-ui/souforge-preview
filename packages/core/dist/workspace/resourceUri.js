import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
/** 统一为正斜杠路径；不依赖 path.sep，避免被误打进 renderer 时对 node:path named export 绑定失败。 */
export function toPosixPath(pathValue) {
    return pathValue.replaceAll('\\', '/');
}
export function makeWorkspaceRelativePath(workspaceRoot, absolutePath) {
    return toPosixPath(relative(workspaceRoot, absolutePath));
}
export function makeFileResourceUri(relativePath) {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
    return `file://${encodeURI(normalized)}`;
}
export function makeStableFileId(workspaceId, relativePath) {
    return `${workspaceId}:${relativePath.replaceAll('\\', '/')}`;
}
export function makeWorkspaceId(workspaceRoot) {
    // Keep this deterministic without hashing at startup. The absolute URL is safe for internal cache keys.
    return pathToFileURL(workspaceRoot).toString();
}
export function makeSymbolUri(kind, scope, id) {
    return `${kind}://${encodeURIComponent(scope)}/${encodeURIComponent(String(id))}`;
}
//# sourceMappingURL=resourceUri.js.map