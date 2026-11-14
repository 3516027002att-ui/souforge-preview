/**
 * 工作区文件的格式族与第一层打开种类。
 *
 * 只根据相对路径的复合后缀判定，不读文件、不调 Bridge。
 * renderer 的 selectEditor / 加载门和 native 完成度矩阵共用这份表，
 * 避免「前端按目录名加载、矩阵按后缀打开」再分叉。
 *
 * 没有真实 parser 的族记 blocked-*，不得伪装成已语义可读。
 */
export type WorkspaceOpenKind = 'param-container' | 'param-rows' | 'gparam' | 'fmg' | 'emevd' | 'msb' | 'script' | 'plain-text' | 'tae' | 'esd' | 'flver' | 'tpf' | 'vfx' | 'container' | 'history' | 'blocked-no-parser' | 'blocked-scope' | 'binary';
export interface WorkspaceFormatFamily {
    familyId: string;
    openKind: WorkspaceOpenKind;
}
export declare function normalizeWorkspaceRelativePath(relativePath: string): string;
export declare function classifyWorkspaceOpen(relativePath: string): WorkspaceFormatFamily;
export declare function isHistoryArtifactPath(relativePath: string): boolean;
export declare function isSemanticOpenKind(kind: WorkspaceOpenKind): boolean;
