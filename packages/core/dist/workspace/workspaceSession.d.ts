import type { Diagnostic, OverlayLayer, WorkspaceLayers, WorkspaceSessionMeta } from '@soulforge/shared';
export interface OpenWorkspaceSessionOptions {
    overlayRoot: string;
    baseRoot?: string;
    stagingRoot?: string;
    game?: string;
}
export interface ResolveWritablePathResult {
    ok: boolean;
    absolutePath?: string;
    layer: OverlayLayer;
    diagnostics: Diagnostic[];
}
export interface WorkspaceSession {
    meta: WorkspaceSessionMeta;
    layers: WorkspaceLayers;
    /** Returns true when absolutePath is inside the writable overlay root. */
    isOverlayPath(absolutePath: string): boolean;
    /** Returns true when absolutePath is inside the optional base root. */
    isBasePath(absolutePath: string): boolean;
    /**
     * Resolve a path that is allowed for Patch Engine writes.
     * Opened overlay paths win even when they are nested inside a mounted game
     * tree. Staging is the only other writable layer.
     */
    resolveWritablePath(absolutePath: string, layer?: OverlayLayer): ResolveWritablePathResult;
    /**
     * Authoritative write check that resolves existing junctions/symbolic links.
     * Call this immediately before filesystem mutation; the synchronous method is
     * only a lexical precheck for UI and proposal construction.
     */
    resolveWritablePathSecure(absolutePath: string, layer?: OverlayLayer): Promise<ResolveWritablePathResult>;
    /** Map a relative path to the overlay absolute path. */
    toOverlayPath(relativePath: string): string;
    /** Map a relative path to the base absolute path when base exists. */
    toBasePath(relativePath: string): string | undefined;
}
/**
 * Workspace session: the opened Mod workspace (overlay) is writable.
 * Overlay may sit inside a mounted game install (e.g. Sekiro\\mods); those
 * opened paths stay writable. Sibling files that are only in the mounted game
 * tree and not in the opened workspace stay rejected.
 *
 * The paths exposed through `layers` stay in the namespace selected by the
 * caller. This matters on Windows, where `realpath()` may expand an 8.3 alias
 * such as RUNNER~1 into a long path and make a valid caller-built child path
 * appear lexically unrelated. Physical paths are retained separately for
 * identity, alias detection and the authoritative reparse-point write gate.
 */
export declare function openWorkspaceSession(options: OpenWorkspaceSessionOptions): Promise<WorkspaceSession>;
/**
 * Reject the removed path/locator contract at the runtime boundary too, so
 * stale JavaScript callers receive a useful diagnostic instead of silently
 * reintroducing a third-party schema dependency.
 */
export declare function assertNoExternalEmedfOptions(input: unknown): void;
export declare function assertWritableThroughSession(session: WorkspaceSession | undefined, absolutePath: string): Diagnostic[];
export declare function assertWritableThroughSessionSecure(session: WorkspaceSession | undefined, absolutePath: string): Promise<Diagnostic[]>;
