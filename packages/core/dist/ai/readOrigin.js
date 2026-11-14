/**
 * Read origin: which layer a read tool reads from.
 *
 * `--base` used to reach the session only as a compression/Oodle runtime root
 * (`session.layers.baseRoot` → `oodleRuntimeRoot`). The workspace was then the
 * only readable layer, so "is this vanilla, or did I change it?" had no answer:
 * a workspace that was already modified could only be read as itself.
 *
 * This module does not add a second reader. It maps the same model-facing file
 * token onto a different root — `<overlayRoot>/<relative>` for
 * `origin: "workspace"` (the default, behaviour unchanged) and
 * `<baseRoot>/<relative>` for `origin: "base"` — and hands the existing native
 * read path an absolute host path it already knows how to open.
 *
 * The base root is the vanilla install root: the directory whose children are
 * `event/`, `param/`, `chr/`, … A `mods/` directory *below* the game root is a
 * mod overlay, not vanilla, so base reads never fall back into it — answering
 * "vanilla" with a mod file is the exact failure this is meant to remove.
 */
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fail, normalizeFileToken, resolveIndexedResourceFile } from './toolRegistrySupport.js';
import { normalizeRelativeToken, parseFileUriToken } from '../editing/fileToken.js';
import { isPathInside } from '../workspace/pathBoundary.js';
/** The layer-agnostic provenance block every origin-aware read publishes. */
export function readOriginSource(origin, relativePath) {
    return { root: origin, path: relativePath };
}
/** Parse the model-facing origin selector. Omitted means the workspace. */
export function parseReadOrigin(value) {
    if (value === undefined || value === null)
        return { ok: true, origin: 'workspace' };
    if (value === 'workspace' || value === 'base')
        return { ok: true, origin: value };
    return {
        ok: false,
        code: 'INVALID_ORIGIN',
        message: `origin 只能是 "workspace"（默认，当前打开的工作区）或 "base"（游戏原版）；收到 ${JSON.stringify(value)}。`
    };
}
/** Workspace-relative POSIX spelling of an absolute path, when it is inside the overlay. */
export function workspaceRelativeOf(context, absolutePath) {
    const root = context.session?.layers?.overlayRoot;
    return root === undefined ? undefined : workspaceRelativePath(root, absolutePath);
}
export function baseRootOf(context) {
    const root = context.session?.layers?.baseRoot;
    return root === undefined || root.trim() === '' ? undefined : root;
}
/**
 * Resolve a file token against the game base root.
 *
 * Accepts the same tokens the workspace resolver accepts: a workspace-relative
 * path, the indexed `file://<relative>` identity, a `base://<relative>`
 * identity, or an absolute host path inside either root. Anything that would
 * leave the base root is refused rather than clamped.
 */
export async function resolveBaseOriginFile(context, input) {
    const baseRoot = baseRootOf(context);
    if (!baseRoot) {
        return {
            ok: false,
            code: 'BASE_ROOT_UNAVAILABLE',
            message: 'origin:"base" 需要先挂载游戏原版目录（CLI: --base <只狼安装根目录>）。'
                + '本次会话没有 base 层，已拒绝把工作区文件当成原版返回。'
        };
    }
    const token = input.trim();
    const fileUri = parseFileUriToken(token);
    if (fileUri?.kind === 'invalid')
        return invalidFileUri(fileUri.message, { origin: 'base' });
    const refused = (message, path) => ({
        ok: false, code: 'BASE_ORIGIN_PATH_INVALID', message,
        details: { origin: 'base', ...(path === undefined ? {} : { path }) }
    });
    const overlayRoot = context.session?.layers?.overlayRoot;
    try {
        const [physicalBase, physicalOverlay] = await Promise.all([
            realpath(baseRoot),
            overlayRoot === undefined ? undefined : realpath(overlayRoot)
        ]);
        if (physicalOverlay && isPathInside(physicalOverlay, physicalBase)) {
            return refused('--base 指向当前 Mod 工作区内的目录，无法独立读取原版。');
        }
        // Prefer overlay-relative identities: nested Mod files also sit below --base,
        // but their `mods/` prefix must not be carried into an original read.
        const fromHost = (candidate) => (overlayRoot === undefined ? undefined : workspaceRelativePath(overlayRoot, candidate))
            ?? (physicalOverlay === undefined ? undefined : workspaceRelativePath(physicalOverlay, candidate))
            ?? workspaceRelativePath(baseRoot, candidate)
            ?? workspaceRelativePath(physicalBase, candidate);
        const relativePath = fileUri?.kind === 'host-path'
            ? fromHost(fileUri.path)
            : fileUri?.kind === 'workspace-relative'
                ? fileUri.relativePath
                : isAbsolute(token)
                    ? fromHost(token)
                    : normalizeRelativeToken(token.replace(/^base:\/\//iu, ''));
        if (relativePath === undefined) {
            return refused('无法将资源映射到原版，使用工作区相对路径、资源 URI 或已绑定目录中的绝对路径。');
        }
        const candidate = resolve(physicalBase, ...relativePath.split('/'));
        if (!isPathInside(physicalBase, candidate) || (physicalOverlay && isPathInside(physicalOverlay, candidate))) {
            return refused('原版资源路径落在当前 Mod 工作区或原版目录之外。', relativePath);
        }
        const missing = () => ({
            ok: false, code: 'BASE_FILE_MISSING',
            message: `原版目录里没有 ${relativePath}；不会用工作区资源代替原版。`,
            details: { origin: 'base', path: relativePath }
        });
        const physicalFile = await realpath(candidate).catch((error) => {
            if (error.code === 'ENOENT' || error.code === 'ENOTDIR')
                return undefined;
            throw error;
        });
        if (!physicalFile)
            return missing();
        if (!isPathInside(physicalBase, physicalFile) || (physicalOverlay && isPathInside(physicalOverlay, physicalFile))) {
            return refused('原版资源经链接指向当前 Mod 工作区或原版目录之外。', relativePath);
        }
        if (!(await stat(physicalFile)).isFile())
            return missing();
        // Give readers the same physical path we verified, not the original link.
        return { ok: true, origin: 'base', path: physicalFile, sourceUri: `base://${relativePath}`, relativePath };
    }
    catch {
        return refused('无法核实原版资源的实际路径，已拒绝标记为 base。');
    }
}
/**
 * Resolve a file token for one read, from the workspace catalog (default) or
 * from the game base root. Both arms return an absolute host path, so the
 * native reader below is unchanged.
 */
export async function resolveReadOriginFile(context, input, resourceKind, origin) {
    if (origin === 'base')
        return resolveBaseOriginFile(context, input);
    const token = input.trim();
    const fileUri = parseFileUriToken(token);
    if (fileUri?.kind === 'invalid')
        return invalidFileUri(fileUri.message, { origin: 'workspace' });
    const resolved = resolveIndexedResourceFile(context, token, resourceKind);
    if (!resolved.ok)
        return resolved;
    // A `file:` token is not a path. When the catalog already answered with the
    // canonical absolute path, that path wins; otherwise the URI is converted
    // before it is rooted, so it can never become a `<root>/file:…` segment.
    const resolvedPath = resolved.canonical === true || fileUri === undefined
        ? resolved.path
        : fileUri.kind === 'host-path'
            ? fileUri.path
            : fileUri.relativePath;
    const overlayRoot = context.session?.layers.overlayRoot;
    const absolutePath = isAbsolute(resolvedPath) ? resolvedPath : overlayRoot ? join(overlayRoot, resolvedPath) : resolvedPath;
    return {
        ok: true,
        origin: 'workspace',
        path: absolutePath,
        sourceUri: resolved.sourceUri,
        relativePath: (overlayRoot ? workspaceRelativePath(overlayRoot, absolutePath) : undefined)
            ?? (fileUri?.kind === 'workspace-relative' ? fileUri.relativePath : undefined)
            ?? normalizeRelativeToken(token)
            ?? normalizeFileToken(token),
        ...(resolved.canonical === true ? { canonical: true } : {})
    };
}
/**
 * A write tool must never accept `origin:"base"` — and must not silently accept
 * any other value either.
 *
 * Write tools do not declare the selector, so an undeclared extra would
 * otherwise be ignored in silence: the caller would believe it was writing
 * vanilla while the write landed in the workspace. This is the single refusal
 * point for the whole registry, so a new write tool is covered without having
 * to remember it.
 */
export function rejectWriteOrigin(name, permissionLevel, origin) {
    if (permissionLevel === 'read' || permissionLevel === 'analyze')
        return undefined;
    if (origin === undefined || origin === null || origin === 'workspace')
        return undefined;
    if (origin === 'base') {
        return fail('BASE_ORIGIN_READ_ONLY', `origin:"base" 是只读来源：游戏原版目录永远不能被写入。`
            + `工具 '${name}' 的权限级别是 ${permissionLevel}（不是 read），本次调用已拒绝，没有暂存、没有备份、没有提交。`
            + '写类工具只接受 origin:"workspace"（或省略 origin），并且只能写当前打开的工作区；'
            + '要对比原版请用 read_* 工具带 origin:"base" 读取，或 compare_with_base。', { origin: 'base', tool: name, permissionLevel });
    }
    return fail('INVALID_ORIGIN', `origin 只能是 "workspace"（工作区）或 "base"（原版只读）；收到 ${JSON.stringify(origin)}。`
        + `工具 '${name}' 是 ${permissionLevel} 级写类工具，只能写工作区，因此 origin 只能省略或为 "workspace"。`, { origin, tool: name, permissionLevel });
}
function invalidFileUri(message, details) {
    return { ok: false, code: 'INVALID_FILE_URI', message, ...(details === undefined ? {} : { details }) };
}
function workspaceRelativePath(root, absolutePath) {
    if (!isAbsolute(absolutePath))
        return undefined;
    const rel = relative(root, absolutePath);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        return undefined;
    return rel.replaceAll('\\', '/');
}
//# sourceMappingURL=readOrigin.js.map