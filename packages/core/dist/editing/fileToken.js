/**
 * Model-facing TAE file token → host path.
 *
 * A TAE token reaches this module from two directions:
 *
 *  - tools that already resolved a catalog entry (`resolveIndexedResourceFile` +
 *    `nativePathFromFileToken`) hand over a host path;
 *  - tools that forward the model's `file` argument unchanged hand over whatever
 *    the caller said. `search_resources` / `search_tae_events` answer with the
 *    indexed identity `file://chr/c0000.anibnd.dcx`, and a caller can also pass a
 *    local URL such as `file:///C:/…`.
 *
 * A `file:` token is a reference, never a path fragment. Joining it onto the
 * overlay root produced `<overlay>\file:\C:\…\c0000.tae`: the URI became a
 * directory name because `isAbsolute('file:///C:/…')` is false on Windows.
 * Resolution therefore classifies the token first and either yields a host path
 * (or the workspace-relative path it names) or refuses with a structured error.
 *
 * This module lives under `editing/` on purpose: `editing/` may not import `ai/`,
 * and both the origin-aware readers (`ai/readOrigin.ts`) and the TAE facade need
 * one implementation, not two.
 */
import { access } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Interpret a `file:` token as a reference — never as a relative path.
 *
 * Everything else is refused rather than guessed: `file://x!/child` names a BND
 * child selector, not a host file (`!` is URI-legal but not a path character);
 * `file:\C:\…` is the exact shape a path concatenation produces when it stuffs a
 * URI into a path; a drive in the authority (`file://C:/…`) and remote
 * authorities are malformed or outside both layers.
 *
 * Returning `undefined` for a non-`file:` token leaves ordinary paths untouched.
 */
export function parseFileUriToken(token) {
    if (!/^file:/iu.test(token))
        return undefined;
    if (token.includes('\\')) {
        return {
            kind: 'invalid',
            message: `file: URI 不能包含反斜杠（收到 ${JSON.stringify(token)}）：反斜杠不是 URL 语法，`
                + '出现它通常说明某处把路径拼进了 URI。'
        };
    }
    if (token.includes('!')) {
        return {
            kind: 'invalid',
            message: `file: URI 里的 \`!/子项\` 是 BND 子项选择器，不是宿主文件路径（收到 ${JSON.stringify(token)}）。`
        };
    }
    const rest = token.slice('file:'.length);
    if (!rest.startsWith('//')) {
        // `file:C:/…` / `file:/…`: only an absolute local URL names a host file.
        const path = localPathOfFileUrl(token);
        if (path === undefined || !isAbsolute(path)) {
            return {
                kind: 'invalid',
                message: `无法把 ${JSON.stringify(token)} 解析成绝对文件路径；file: 之后必须是绝对路径（例如 file:///C:/…）。`
            };
        }
        return { kind: 'host-path', path };
    }
    const afterAuthority = rest.slice(2);
    if (afterAuthority.startsWith('/'))
        return hostPathOfFileUri(token);
    if (afterAuthority.startsWith('localhost/'))
        return hostPathOfFileUri(token);
    if (afterAuthority === '') {
        return { kind: 'invalid', message: 'file:// 后面缺少文件路径。' };
    }
    if (/^[A-Za-z]:/u.test(afterAuthority)) {
        return {
            kind: 'invalid',
            message: `file:// 后面的盘符属于 URL authority，不是路径（收到 ${JSON.stringify(token)}）；`
                + '盘符必须写成 file:///C:/…（三个斜杠）。'
        };
    }
    // Catalog identity: `file://<workspace-relative>`.
    return workspaceRelativeOfFileUri(afterAuthority, token);
}
/** Workspace-relative POSIX spelling, refusing traversal and absolute paths. */
export function normalizeRelativeToken(value) {
    const normalized = value.replaceAll('\\', '/').replace(/^\/+/u, '');
    const segments = normalized.split('/').filter((segment) => segment.length > 0 && segment !== '.');
    if (segments.length === 0 || segments.some((segment) => segment === '..'))
        return undefined;
    return segments.join('/');
}
/**
 * Resolve a TAE/ANIBND token to a host path.
 *
 * `allowBaseRead` is for read-only callers: without it a base-layer path is
 * rejected (a write must never be resolved onto the game install). With it a
 * path inside the mounted base root is accepted so the same reader can answer
 * "what does the vanilla container contain?" — the write gate still refuses
 * that path later, because base is not a writable layer.
 *
 * A `file:` token never reaches the candidate list as a path fragment: it is
 * classified first, so it either resolves to a host path / workspace-relative
 * path or fails with TAE_FILE_URI_INVALID.
 */
export async function resolveAnibndFile(edit, file, options = {}) {
    const fileUri = parseFileUriToken(file);
    if (fileUri?.kind === 'invalid') {
        return {
            ok: false,
            error: {
                code: 'TAE_FILE_URI_INVALID',
                message: `动作文件的 file: 引用不合法：${fileUri.message}`
            }
        };
    }
    // `file:` is a reference, not a path: unwrap it before the candidate list, so
    // the URI can never become a `<overlay>/file:…` segment.
    const token = fileUri === undefined ? file : fileUri.kind === 'host-path' ? fileUri.path : fileUri.relativePath;
    const overlay = edit.session.layers.overlayRoot;
    const candidates = [
        resolve(token),
        join(overlay, token),
        join(overlay, 'chr', token),
        join(overlay, 'chr', `${token}.anibnd.dcx`),
        join(overlay, 'chr', `${token}.anibnd`)
    ];
    for (const candidate of candidates) {
        try {
            await access(candidate);
            const writable = edit.session.resolveWritablePath(candidate);
            if (!writable.ok && !(options.allowBaseRead === true && edit.session.isBasePath(candidate)))
                continue;
            return { ok: true, path: candidate };
        }
        catch {
            // try next
        }
    }
    return {
        ok: false,
        error: { code: 'TAE_FILE_NOT_FOUND', message: `工作区内找不到动作文件：${file}（期望 chr/cXXXX.anibnd.dcx）` }
    };
}
function localPathOfFileUrl(token) {
    try {
        return fileURLToPath(token);
    }
    catch {
        return undefined;
    }
}
function hostPathOfFileUri(token) {
    const path = localPathOfFileUrl(token);
    if (path === undefined || !isAbsolute(path)) {
        return {
            kind: 'invalid',
            message: `无法把 ${JSON.stringify(token)} 解析成宿主文件路径：它不是本机可打开的 file: URL。`
        };
    }
    return { kind: 'host-path', path };
}
function workspaceRelativeOfFileUri(raw, token) {
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    }
    catch {
        return { kind: 'invalid', message: `file: URI 的百分号编码无效（收到 ${JSON.stringify(token)}）。` };
    }
    // Decoding must not smuggle an absolute path, a Windows separator or a child
    // selector into what is then joined as a workspace-relative path.
    if (decoded.startsWith('/') || decoded.startsWith('\\') || /^[A-Za-z]:/u.test(decoded)
        || decoded.includes('\\') || decoded.includes('!') || /[\u0000-\u001f]/u.test(decoded)) {
        return {
            kind: 'invalid',
            message: `file:// 后的 ${JSON.stringify(raw)} 解码后不是工作区相对路径（收到 ${JSON.stringify(token)}）。`
        };
    }
    const relativePath = normalizeRelativeToken(decoded);
    if (relativePath === undefined) {
        return {
            kind: 'invalid',
            message: `file:// 后不是可用的工作区相对路径（收到 ${JSON.stringify(token)}）。`
        };
    }
    return { kind: 'workspace-relative', relativePath };
}
//# sourceMappingURL=fileToken.js.map