/**
 * Renderer-safe script container evidence projection.
 *
 * Pairs with `packages/core/src/script/scriptContainerEvidence.ts` (production
 * authority). The renderer never receives absolute paths: the preload strips
 * path-bearing fields before this DTO crosses the context bridge, so the
 * entries are identified by logical inner names only.
 *
 * SoulForge does not execute scripts. Inner `.lua` / `.hks` files that use the
 * current Sekiro HKS dialect are decompiled and recompiled by the first-party
 * Bridge; future or out-of-scope dialects remain structured failures rather
 * than being presented as fake source.
 */
/** Fixed display order for classification chips. */
export const SCRIPT_CLASSIFICATION_ORDER = [
    'lua-bytecode',
    'luagnl',
    'luainfo',
    'esd-bytecode',
    'hkx-bytecode',
    'unknown'
];
export function scriptClassificationLabel(classification) {
    switch (classification) {
        case 'lua-bytecode':
            return 'Lua 字节码';
        case 'luagnl':
            return 'LUAGNL 全局名表';
        case 'luainfo':
            return 'LUAINFO 参数元数据';
        case 'esd-bytecode':
            return 'ESD 状态机字节码';
        case 'hkx-bytecode':
            return 'HKX 行为字节码';
        default:
            return '未知';
    }
}
//# sourceMappingURL=script-container.js.map