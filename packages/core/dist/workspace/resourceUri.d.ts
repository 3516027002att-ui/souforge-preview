import type { ResourceKind } from '@soulforge/shared';
/** 统一为正斜杠路径；不依赖 path.sep，避免被误打进 renderer 时对 node:path named export 绑定失败。 */
export declare function toPosixPath(pathValue: string): string;
export declare function makeWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string;
export declare function makeFileResourceUri(relativePath: string): string;
export declare function makeStableFileId(workspaceId: string, relativePath: string): string;
export declare function makeWorkspaceId(workspaceRoot: string): string;
export declare function makeSymbolUri(kind: ResourceKind, scope: string, id: string | number): string;
