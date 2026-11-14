/**
 * Build a VFS tree from a sandbox test workspace.
 * Open-time scan uses bounded prefix probes — no full-file reads for large/packed assets.
 */
import type { BuildVfsOptions, VfsTree } from '@soulforge/shared';
export declare function buildVfsFromWorkspace(options: BuildVfsOptions): Promise<VfsTree>;
