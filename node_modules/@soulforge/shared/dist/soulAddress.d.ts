/**
 * 动作 / 地图的参数同构编址（问题 6）。
 *
 * 所有 padStart / 正则只准写在这里。各面板、索引、RAG、Agent 工具一律经
 * 本模块解析 / 格式化，禁止各面板手写一份。
 *
 * 地址语法（写死，与 docx/动作与地图Agent编址.docx 与 锐评/grok.txt 问题 6 同口径）：
 *
 *   动作：c1050 · c1050#A0200 · c1050#A0200.e0 · c1050#A0200.e0.startFrame
 *   地图：M11 · m11_01_00_00 · m11_01_00_00#c1050_0000 · m11_01_00_00#c1050_0000.posX
 *
 * symbolUri（稳定，给 RAG / cite）：
 *   action://c1050/A0200/e0
 *   action://c1050/tae/3/A0200/e0
 *   map://m11_01_00_00/part/c1050_0000
 *   map://m11_01_00_00/region/<name>
 *
 * 约定：
 *  - `cXXXX` 从路径 `chr/c1050.anibnd.dcx` / `c1050.chrbnd.dcx` 提取，
 *    正则 `(^|[/\\])c(\d{4})([./\\]|$)`。
 *  - `A0200` = `'A' + String(animId).padStart(4, '0')`，主键恒为 A+animId；
 *    合法 hkx 茎（如 `a000_020000`）只是检索别名，不做第二套主键。
 *  - `eN` 是该动画 `events[]` 的下标（不是 eventTypeId）。
 *  - 块 ID 必须是 `m\d{2}_\d{2}_\d{2}_\d{2}`，下划线是 ID 的一部分。
 *  - 实体名用 MSB part/region 原名，不翻译。
 */
export interface ActionAddress {
    /** `c1050`。 */
    chr: string;
    /** animId（如 200）。缺省表示只到角色级地址。 */
    animId?: number;
    /**
     * ANIBND 内 TAE child 的 section selector。直接写数字时表示 BND4
     * entryIndex；它只在当前 source 内有意义，不能替代 animId。
     */
    taeEntryIndex?: number;
    /** 显式的 BND4 entryId selector（与 taeEntryIndex/name/group 互斥）。 */
    taeEntryId?: number;
    /** 显式的 TAE child basename selector（与其他 selector 互斥）。 */
    taeEntryName?: string;
    /** 显式的逻辑 TAE group selector（与其他 selector 互斥）。 */
    taeGroup?: string;
    /** 该动画 events[] 下标（如 e0 的 0）。 */
    eventIndex?: number;
    /** 字段名（startFrame / endFrame / SoundID / …）。 */
    field?: string;
}
export interface MapAddress {
    /** 完整四段块 ID，如 `m11_01_00_00`。 */
    block: string;
    /** MSB part/region 原名；缺省表示只到块级地址。 */
    name?: string;
    /**
     * 重名实体的原生偏移消歧符（地址里的 `@0x4f50c0`）。
     *
     * MSB 允许同名 part（m11_01_00_00 里 `c1010_0071` 就有两个），`<mapId>#<name>` 因此不唯一。
     * 唯一名字的地址保持旧形式；只有重名时才追加本字段，所以已有调用方看到的地址不变。
     */
    nativeOffset?: number;
    /** 字段名（posX / posY / …）。 */
    field?: string;
}
/** animId → `A0200` (无任意五位上限，但必须是非负 safe integer)。 */
export declare function formatAnimCode(animId: number): string;
/** `A0200` / `A200` / `A100000` → animId；解析不出或超出 safe integer 返回 null。 */
export declare function parseAnimCode(value: string): number | null;
/** 从路径 / 茎提取角色 id：`chr/c1050.anibnd.dcx` / `c1050.chrbnd.dcx` → `c1050`。 */
export declare function formatChrId(pathOrStem: string): string | null;
/** 提取完整四段块 ID：`map/m11_01_00_00/m11_01_00_00.msb.dcx` → `m11_01_00_00`。 */
export declare function formatMapBlock(pathOrId: string): string | null;
/** 块 → 区域号：`m11_01_00_00` → `M11`。解析不出返回空串。 */
export declare function formatMapArea(block: string): string;
/**
 * 动作地址 → 字符串。无 section selector 时保留旧语法
 * `c1050#A0200.e0.startFrame`；有 selector 时输出 canonical action URI，
 * 例如 `{ chr:'c1050', taeEntryIndex:3, animId:200, eventIndex:0 }` →
 * `action://c1050/tae/3/A0200/e0`。
 */
export declare function formatActionAddress(address: ActionAddress): string;
/**
 * 解析动作地址字符串（A 主键形式：`c1050#A0200.e0.startFrame`）。
 *
 * hkx 茎别名（`c1050#a000_020000`）能被 extractAtomicAddressTokens 整体保留供
 * 检索，但别名不能单凭文件名还原目标 TAE 段和 animId：标准 own-HKX 动作
 * 可以与 stem 编号相同，import/alias 和跨段重号仍需原生映射确认。writer 需要
 * 完整目标身份，故解析器对别名形式
 * fail-closed 返回 null，不编造主键 —— 未知映射不能开放读写目标。
 */
export declare function parseActionAddress(value: string): ActionAddress | null;
/**
 * 地图地址 → 字符串：
 * `{ block:'m11_01_00_00', name:'c1050_0000', field:'posX' }` → `m11_01_00_00#c1050_0000.posX`；
 * 带 `nativeOffset` 时 → `m11_01_00_00#c1050_0000@0x1234.posX`（只在重名时由调用方给出）。
 */
export declare function formatMapAddress(address: MapAddress): string;
/**
 * 解析地图地址字符串：`m11_01_00_00#c1050_0000.posX`，以及重名消歧形式
 * `m11_01_00_00#c1010_0071@0x4f50c0`。
 *
 * `@0x<hex>` 只在紧贴名字（或名字与 `.field` 之间）时按偏移解析；名字里其它位置的 `@`
 * 仍属于名字，所以既有的 `<mapId>#<name>` 地址含义不变。
 */
export declare function parseMapAddress(value: string): MapAddress | null;
/**
 * 同一地图内出现多次的名字集合。地址 `<block>#<name>` 只对唯一名字是稳定标识；
 * 重名时必须追加 `@0x<offset>`，否则两个不同实体会共享同一个地址。
 */
export declare function duplicatedMapNames(items: ReadonlyArray<{
    name: string;
}>): Set<string>;
/**
 * 一组地图实体 → 与 `read_msb_parts` 完全同口径的地址数组（下标与输入对齐）。
 *
 * 唯一名字保持 `<mapId>#<name>`；重名实体追加 `@0x<offset>`。索引、RAG、Agent 工具
 * 一律经这里生成地址，禁止各处手写一份偏移格式化。
 */
export declare function formatMapEntityAddresses<T extends {
    name: string;
    nativeOffset?: number;
}>(block: string, items: ReadonlyArray<T>): string[];
/** 地图实体家族：part / region。 */
export type MapSymbolFamily = 'part' | 'region';
/**
 * 地图实体 → symbolUri，与 {@link formatMapEntityAddresses} 一一对应：
 * 唯一名字 `map://<mapId>/part/<name>`；重名实体 `map://<mapId>/part/<name>@0x<offset>`。
 *
 * 旧 Bridge 语义导出的 `~1`（第 n 次出现）只是出现序号，无法从地址反推，也不能跨
 * ingest 路径保证唯一；这里统一改成原生偏移，地址与 uri 因此能互相定位。
 */
export declare function formatMapEntityUri(input: {
    block: string;
    family: MapSymbolFamily;
    name: string;
    nativeOffset?: number;
    duplicated?: boolean;
}): string;
/**
 * uri / 地址里的 `@0x<offset>` 偏移，以及去掉偏移后的名字。
 * 支持 `map://<mapId>/part/<name>@0x4f50c0`、`<mapId>#<name>@0x4f50c0`、`<name>@0x4f50c0`。
 */
export declare function parseMapOffsetSuffix(value: string): {
    name: string;
    nativeOffset: number;
} | null;
/**
 * 从文本里抽出原子地址 token（大小写不敏感，一律小写；下划线是 ID 一部分，
 * 保留不拆）。至少覆盖：`c\d{4}`、`A\d+`、`a\d{3}_\d+`（hkx 茎）、`M\d{2}`、
 * `m\d{2}_\d{2}_\d{2}_\d{2}`、以及带 `#` 的完整地址（含 .eN / .field）。
 * 供 queryParse tokenize 与 lookupIndex 在切词前先抽地址，避免被 replaceAll 拆碎。
 */
export declare function extractAtomicAddressTokens(text: string): string[];
