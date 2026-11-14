/**
 * 本机 Yapped Rune Bear 元数据只读导入（T5-1 / T5-3）。
 *
 * ── 这是什么 ──
 *
 * Smithbox 元数据（importPinnedSmithboxSdtParamMetadata）给的是 **英文** 字段名
 * （Param Annotations/English）。用户装的中文汉化版 Yapped 在
 * `Paramdex\SDT\Defs\*.xml` 里带 **中文 DisplayName / Description**，字段名读起来
 * 是「持续时间」「HP上限倍率」这种。本模块只从本机 Yapped 安装只读抽取这两样，
 * 覆盖到 Smithbox 文档上；Yapped 缺的字段保留 Smithbox 英文，禁止用日文
 * DisplayName 当主标签。
 *
 * 刻意不做成 Smithbox 那样的「钉死发布包」：Yapped 是本机第三方工具安装目录，
 * 不是可再分发来源，没有归档摘要可钉。这里只读、不入库、失败降级（拿不到就
 * 回落到 Smithbox 英文，绝不把「中文名不可用」升级成「PARAM 不可用」）。
 *
 * 同样读取 `Paramdex\SDT\Names\<EntryName>.txt` 的行名表（T5-3）：PARAM 行的名字
 * 优先由 Bridge 从文件内名称区解码；空时回落 Yapped 行名；再空显示 `—`。
 *
 * ── 路径归属 ──
 *
 * 本机 Yapped 路径只出现在 main 进程（ipc.ts），渲染器拿不到。Defs/Names 文件
 * 只在 main 侧读一次并缓存为内存索引，不进 app.db、不进工作区、不 commit 入库。
 */
import type { ParamDefDocument } from '@soulforge/shared';
export interface YappedSourceDiagnostic {
    severity: 'error' | 'info';
    code: string;
    message: string;
}
/** 单个字段的 Yapped 覆盖（中文 DisplayName / Description）。 */
export interface YappedFieldOverlay {
    displayName?: string;
    description?: string;
}
/** 一个 param 的 Yapped 覆盖，按 ParamType 键。 */
export interface YappedParamOverlay {
    typeName: string;
    dataVersion?: number;
    /** fieldId → 覆盖。 */
    fields: ReadonlyMap<string, YappedFieldOverlay>;
}
export interface YappedSdtDefsResult {
    ok: boolean;
    /** ParamType → 覆盖。 */
    byTypeName: ReadonlyMap<string, YappedParamOverlay>;
    defCount: number;
    fieldCount: number;
    diagnostics: YappedSourceDiagnostic[];
}
export interface YappedSdtRowNamesResult {
    ok: boolean;
    /**
     * 容器条目名（如 `SpEffectParam`）→ 行 id → 名字。
     *
     * Names 文件名就是条目名（SpEffectParam.txt ↔ 容器条目 SpEffectParam.param），
     * 与 Defs 文件名（SpEffect.xml ↔ ParamType SP_EFFECT_PARAM_ST）不是同一把键。
     */
    byEntryName: ReadonlyMap<string, ReadonlyMap<number, string>>;
    nameFileCount: number;
    diagnostics: YappedSourceDiagnostic[];
}
/**
 * 读 `Defs/*.xml`：每个文件提取 ParamType + 逐字段 DisplayName/Description。
 *
 * ── 失败语义 ──
 *
 * 目录不存在 → ok:true + 空索引 + info 诊断（可选增强，不回失败）。
 * 某个 xml 畸形/DTD/Def 文法未知 → 记 error 诊断但**继续**读其它文件：一个坏
 * 文件不该让全部表失去中文名。ok 只表示「至少有一张表可读」—— 对可选增强而言
 * 部分成功也是成功；诊断里逐条给出坏文件。
 */
export declare function readYappedSdtDefsIndex(defsRootDir: string): Promise<YappedSdtDefsResult>;
/**
 * 读 `Names/*.txt`：每行 `id name -- 日文名`，条目名 = 文件名。
 *
 * 名字区里的英文名是 HTML 实体编码的（实测 `Don&#39;t` = `Don't`、
 * `&amp;`/`&quot;`），解析时解码。日文侧只是对照参考，不参与显示名。
 */
export declare function readYappedSdtRowNamesIndex(namesRootDir: string): Promise<YappedSdtRowNamesResult>;
/**
 * 文本是否判定为「日文」（含平假名或片假名）。
 *
 * 中文与日文共享 CJK 统一表意文字，光看汉字分不出；但平假名/片假名是日文
 * 独有。规则取保守侧：只要出现假名就当日文，避免把「状态」这类汉日同形词
 * 误判成日文 —— 误判只损失一次显示机会（回落到 Smithbox 英文），方向安全。
 */
export declare function looksJapaneseText(text: string): boolean;
/**
 * 把 Yapped 覆盖套到 ParamDefDocument 上（T5-1）。
 *
 * 规则：
 *  · 字段 name ← Yapped 中文 DisplayName（含假名=日文时**不用**，保留 Smithbox 英文）。
 *  · 字段 description ← Yapped Description。
 *  · Yapped 没有的字段原样保留 Smithbox 值。
 *  · 没有任何实际改动时返回原引用（避免无谓的 identity 变化扰动下游 memo）。
 *
 * 这是**显示层覆盖**：origin 与偏移不动，写链（applyParamFieldMutation）只消费
 * 字段 id/type/offset，不受显示名影响。
 */
export declare function applyYappedFieldOverlay(document: ParamDefDocument, overlays: ReadonlyMap<string, YappedParamOverlay>): ParamDefDocument;
/** 查 Yapped 行名：entryName 是该 param 的容器条目名（不带 .param）。 */
export declare function resolveYappedRowName(entryName: string, rowId: number, rowNamesIndex: ReadonlyMap<string, ReadonlyMap<number, string>> | null): string | undefined;
/**
 * 解析一行 `id name -- 日文`。
 *
 * 分隔符 ` -- ` 存在时 name 取左侧；没有分隔符时 name 取 id 之后整段。
 * 英文名做 HTML 实体解码（`&#39;`/`&amp;`/`&quot;` 实测出现）。
 */
export declare function parseYappedNamesText(text: string): ReadonlyMap<number, string>;
