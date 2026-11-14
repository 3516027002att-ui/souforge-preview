import type { AiToolPermissionLevel, ResourceKind } from '@soulforge/shared';
import type { ToolContext, ToolResult } from './toolRegistry.js';
export type ReadOrigin = 'workspace' | 'base';
/** A file resolved for a read, plus the layer that answered. */
export type ReadOriginFile = {
    ok: true;
    origin: ReadOrigin;
    /** Absolute host path the existing native reader must open. */
    path: string;
    /**
     * Model-facing identity. Base reads never reuse the workspace file URI: two
     * different byte streams must not share one identity.
     */
    sourceUri: string;
    /** Workspace-relative POSIX path, the same shape for both origins. */
    relativePath: string;
    /** True when the workspace resolver matched exactly one indexed file. */
    canonical?: boolean;
};
export type ReadOriginFailure = {
    ok: false;
    code: string;
    message: string;
    details?: unknown;
};
/** The layer-agnostic provenance block every origin-aware read publishes. */
export declare function readOriginSource(origin: ReadOrigin, relativePath: string): {
    root: ReadOrigin;
    path: string;
};
/** Parse the model-facing origin selector. Omitted means the workspace. */
export declare function parseReadOrigin(value: unknown): {
    ok: true;
    origin: ReadOrigin;
} | {
    ok: false;
    code: string;
    message: string;
};
/** Workspace-relative POSIX spelling of an absolute path, when it is inside the overlay. */
export declare function workspaceRelativeOf(context: ToolContext, absolutePath: string): string | undefined;
export declare function baseRootOf(context: ToolContext): string | undefined;
/**
 * Resolve a file token against the game base root.
 *
 * Accepts the same tokens the workspace resolver accepts: a workspace-relative
 * path, the indexed `file://<relative>` identity, a `base://<relative>`
 * identity, or an absolute host path inside either root. Anything that would
 * leave the base root is refused rather than clamped.
 */
export declare function resolveBaseOriginFile(context: ToolContext, input: string): Promise<ReadOriginFile | ReadOriginFailure>;
/**
 * Resolve a file token for one read, from the workspace catalog (default) or
 * from the game base root. Both arms return an absolute host path, so the
 * native reader below is unchanged.
 */
export declare function resolveReadOriginFile(context: ToolContext, input: string, resourceKind: ResourceKind, origin: ReadOrigin): Promise<ReadOriginFile | ReadOriginFailure>;
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
export declare function rejectWriteOrigin(name: string, permissionLevel: AiToolPermissionLevel, origin: unknown): ToolResult<never> | undefined;
