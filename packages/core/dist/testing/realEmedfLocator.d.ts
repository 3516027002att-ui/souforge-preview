export interface RealEmedfLocatorOptions {
    /**
     * 已挂载的游戏根。传入时优先扫描其兄弟 `tools` 目录；未传入时回退到
     * SOULFORGE_SEKIRO_GAME_ROOT。这里只影响路径候选，不读取或解析 EMEDF 内容。
     */
    gameRoot?: string | null;
}
export declare function searchRealEmedf(options?: RealEmedfLocatorOptions): Promise<string | undefined>;
