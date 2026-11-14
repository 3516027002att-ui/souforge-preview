import type { Diagnostic } from '@soulforge/shared';
export interface PathBoundaryResult {
    ok: boolean;
    rootPath: string;
    candidatePath: string;
    diagnostics: Diagnostic[];
}
/**
 * Authoritative filesystem boundary check for write targets.
 *
 * A lexical `path.resolve()` prefix check is not enough on Windows because a
 * junction or symbolic link inside the workspace can redirect a write outside
 * the selected root. This function resolves every existing path prefix and
 * rejects the first prefix whose real target escapes the real workspace root.
 * Non-existing suffixes are safe only when their nearest existing ancestor is
 * still inside the root.
 */
export declare function verifyPathInsideRoot(rootPath: string, candidatePath: string): Promise<PathBoundaryResult>;
export declare function isPathInside(rootPath: string, candidatePath: string): boolean;
export declare function pathsEqual(left: string, right: string): boolean;
