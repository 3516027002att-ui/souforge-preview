/**
 * 工作区顶层目录资源族（不含 unknown）。
 * 放在 shared：renderer 需要同一权威列表，但不能从 core barrel 拉入 Node-only 依赖。
 */
export const KNOWN_RESOURCE_DIRS = [
    'event',
    'map',
    'param',
    'msg',
    'menu',
    'script',
    'action',
    'ai',
    'sfx',
    'chr',
    'obj',
    'other'
];
/** 含 unknown 的完整 ResourceKind 枚举值表。 */
export const ALL_RESOURCE_KINDS = [
    ...KNOWN_RESOURCE_DIRS,
    'unknown'
];
//# sourceMappingURL=types.js.map