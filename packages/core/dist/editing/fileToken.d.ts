import type { NativeEditSession } from './nativeEditSession.js';
/**
 * What a `file:` token actually names.
 *
 * Two shapes exist here and they are not interchangeable:
 *
 *  - a local file URL (`file:///C:/…`, `file:///home/…`, `file:C:/…`): the host
 *    path is what a native reader can open;
 *  - the catalog identity produced by `makeFileResourceUri`
 *    (`file://chr/c0000.anibnd.dcx`): `file://` followed by a workspace-relative
 *    path. It is not a URL authority — `fileURLToPath` would read `chr` as a UNC
 *    host on Windows and silently open a different file.
 */
export type ParsedFileUri = {
    kind: 'host-path';
    path: string;
} | {
    kind: 'workspace-relative';
    relativePath: string;
} | {
    kind: 'invalid';
    message: string;
};
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
export declare function parseFileUriToken(token: string): ParsedFileUri | undefined;
/** Workspace-relative POSIX spelling, refusing traversal and absolute paths. */
export declare function normalizeRelativeToken(value: string): string | undefined;
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
export declare function resolveAnibndFile(edit: NativeEditSession, file: string, options?: {
    allowBaseRead?: boolean;
}): Promise<{
    ok: true;
    path: string;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}>;
