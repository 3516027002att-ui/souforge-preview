/**
 * 明文脚本条目的判定与源码级编辑输入校验。
 *
 * 为什么需要独立一层,而不是复用 scriptContainerEvidence 的分类:
 *
 * `classifyScriptEntry` 对所有 `.lua` / `.hks` 一律返回 `lua-bytecode`,明文条目
 * 只靠 `magicVerified=false` 区分。而那个字段来自**采样**——
 * `MAGIC_SAMPLE_LIMIT = 12` 按容器顺序只验前 12 条,实测
 * `543000_battle.lua`(条目索引 222)的 `magicVerified` 是 `undefined`,
 * 也就是「没验过」。拿一个没验过的条目当明文往里写文本,会把字节码写坏。
 *
 * 所以源码级写用的是**按需、逐条、看真实字节**的判定:要写哪个条目就验哪个,
 * 不接受采样结论,也不接受文件名白名单。文件名可以对得上而内容是字节码
 * ——mod 作者完全可能把编译产物塞成同名条目。
 *
 * ── 实测依据(2026-08-08,本机 Sekiro mod 工作区)──
 *
 * 扫 mods/script 下 11 个 luabnd 容器共 1179 个 `.lua`/`.hks` 条目:
 *   明文 3 个 —— goal_list.lua(21400 B)、543000_battle.lua(53813 B,
 *   在 aicommon.luabnd.dcx)、801000_battle.lua(120489 B,在
 *   **m25_00_00_00.luabnd.dcx**);
 *   字节码 1176 个。
 * 两类的可打印字节比例**完全不重叠**:明文 1.0000,字节码 0.2029–0.6079。
 * 判定阈值 0.99 落在这个真实间隔里,不是估计。
 *
 * 顺带修正两处既有记录:
 *   - scope.json 说 801000_battle.lua 在 aicommon.luabnd.dcx —— 实测不在,
 *     它在 m25_00_00_00.luabnd.dcx;
 *   - scriptContainerEvidence 头注把 logic_list.lua 举例为明文列表文件 ——
 *     实测它是 `\x1bLuaP` 字节码(可打印率 0.6121)。
 *
 * game 侧 12 个容器在本次扫描里全部读取失败(KRAK/Oodle 需要
 * oodleRuntimeRoot,未传)。这不影响本模块:源码级写只写当前打开
 * 工作区的暂存区。结论的覆盖面是 **mod 侧**,不是全量。
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
/**
 * 明文判定的可打印字节比例阈值。
 *
 * 实测明文 1.0000、字节码上限 0.6079,阈值取 0.99 而不是取中点 0.8:
 * 判定要靠紧明文那一侧。落在 0.6–0.99 之间的东西是「说不清」,而说不清的
 * 条目必须被拒绝,不能被当成明文写入。
 */
export declare const PLAINTEXT_PRINTABLE_RATIO_THRESHOLD = 0.99;
/** 判定采样的字节上限。整文件扫一遍对 120 KB 也不慢,但上限让代价可预期。 */
export declare const PLAINTEXT_SAMPLE_BYTES: number;
export type PlaintextVerdictCode = 'PLAINTEXT_CONFIRMED' | 'PLAINTEXT_REJECTED_LUA_BYTECODE_MAGIC' | 'PLAINTEXT_REJECTED_CONTAINS_NUL' | 'PLAINTEXT_REJECTED_LOW_PRINTABLE_RATIO' | 'PLAINTEXT_REJECTED_EMPTY';
export interface PlaintextVerdict {
    /** true 仅当该条目的真实字节确认为明文。 */
    isPlaintext: boolean;
    code: PlaintextVerdictCode;
    /** 可打印字节比例(基于采样)。 */
    printableRatio: number;
    /** 采样字节数(基于剥掉尾部填充后的内容)。 */
    sampledBytes: number;
    /** 总字节数(含尾部填充)。 */
    totalBytes: number;
    /**
     * 尾部 NUL 对齐填充的字节数。
     *
     * 实测三个 action/*nameid.txt 全都有(3 / 5 / 14 字节)。它属于容器对齐,
     * 不是文本内容;回写时必须原样保留,否则条目长度改变。
     */
    trailingPaddingBytes: number;
    /** 是否命中 `\x1bLua` 字节码签名。 */
    luaBytecodeMagic: boolean;
    /** 是否含 NUL 字节。 */
    containsNul: boolean;
    /** 判定用的编码;明文条目按实测可能是 Shift-JIS 而不是 UTF-8。 */
    detectedEncoding: PlaintextEncoding;
    diagnostics: StructuredDiagnostic[];
}
/**
 * 明文条目的编码。
 *
 * 这不是可有可无的细节:action 目录下三个 `*nameid.txt` 实测是 **Shift-JIS**
 * (CP932),首行就是一句日文注释
 * 「#BOM付きUTF8で保存された場合に一行目が解析不能になる…」。
 * 按 UTF-8 读进来会得到 U+FFFD 替换符,再写回去就把所有日文换成了问号,
 * 且字节长度改变。所以编码必须显式判定并在回写时用同一种。
 */
export type PlaintextEncoding = 'ascii' | 'utf8' | 'utf8-bom' | 'shift_jis'
/**
 * 非 ASCII 字节既不能按 UTF-8 也不能按 Shift-JIS 完整解码 —— 文件里混了
 * 多种编码,或用的是第三种编码。
 *
 * 实测来源:`801000_battle.lua` 含原版日文注释 + 后来加的 **GBK 中文**注释
 * (字节 `0xd7 0xf3 0xca 0xd6` 在 GBK 里是「左手」,整句 `×óÊÖµ¯¿ª` = 「左手弹开」),
 * 显然是中文 mod 作者改过。按 Shift-JIS 解码那段会得到 U+FFFD,再编回去就
 * 永久损坏那些字节。
 *
 * 这类文件的**文本级**编辑不可用(整篇往返会丢字节),但**字节级**可以:
 * 走 `replace-ascii-bytes` 只在纯 ASCII 区域替换字节,非 ASCII 字节全程只被
 * 复制。实测 801000_battle.lua 2740 行纯 ASCII、6 行含非 ASCII,字节级替换后
 * 52 个非 ASCII 字节完全不变 —— 文件本身可以无损编辑,先前判定「不可能无损」
 * 是把「整篇往返不可行」错当成了「任何编辑都不可行」。
 *
 * 判成独立取值而不是硬塞进 shift_jis,是为了让拒绝理由说得出实话 ——
 * 误判成 shift_jis 会让日志显示「不支持写入非 ASCII」,而真实原因是
 * 「这个文件的编码本身不一致」,两者该采取的下一步完全不同。
 */
 | 'mixed-unknown';
/**
 * 按真实字节判定一个条目是否明文。
 *
 * 不看文件名、不看扩展名、不用采样结论。文件名可以对得上而内容是字节码。
 */
export declare function classifyPlaintextBytes(bytes: Uint8Array): PlaintextVerdict;
/**
 * 判定明文条目的编码。
 *
 * 顺序有讲究:先看 BOM(确定性),再看是否纯 ASCII(两种编码下字节相同,
 * 标成 ascii 让调用方知道无需转码),再试 UTF-8 严格解码。UTF-8 严格解码
 * 失败而字节又都是文本,就按 Shift-JIS 处理 —— 这是本项目语料的实际情况
 * (action/*nameid.txt),不是通用推断。
 */
export declare function detectPlaintextEncoding(bytes: Uint8Array): PlaintextEncoding;
/**
 * 用判定出的编码解码明文条目。
 *
 * Shift-JIS 走 TextDecoder('shift_jis')。Node 内置 ICU 支持该标签;
 * 不支持时抛出而不是退回 UTF-8 —— 静默退回会产出替换符,而那些替换符
 * 一旦写回就永久替换掉了原文的日文。
 */
export declare function decodePlaintext(bytes: Uint8Array, encoding: PlaintextEncoding): string;
/**
 * 统计解码文本的换行形态（CRLF / LF / CR 三档）。
 *
 * 渲染器要明示 newline（§10.2），而解码后的 JS 字符串无法直接看出原始
 * 换行字节——`\r\n` 与 `\n` 在 UI 里都渲染成回车。逐个字符扫：CRLF 成对
 * 计一次并把 LF 跳过，避免把 `\r\n` 同时计成 cr 与 lf。
 */
export declare function analyzePlaintextLineEndings(text: string): {
    crlf: number;
    lf: number;
    cr: number;
};
/**
 * 把编辑后的文本编回字节。
 *
 * ── Shift-JIS 的编码方向 ──
 *
 * 实测:Node 内置 `TextDecoder` 支持 `shift_jis`,但 `TextEncoder` 的 encoding
 * **固定为 utf-8**(传参数也无效,实测 `new TextEncoder('shift_jis').encoding`
 * 仍返回 `'utf-8'`),而本仓库没有 iconv 类依赖。
 *
 * 我最初据此判定「Shift-JIS 方向没有编码器」,于是只允许纯 ASCII 结果。
 * 那个结论下得太早:实测那样一来 3 个 action/*nameid.txt 完全无法源码级编辑
 * ——它们首行就是日文注释「#BOM付きUTF8で…」,任何编辑的结果都含非 ASCII。
 *
 * 编码表不必手写,可以**用解码器枚举出来**(见 encodeShiftJis)。解码器是权威,
 * 反推出的表与它天然一致;手抄码表才有漂移风险。已实测三个文件的
 * 解码→编码往返逐字节一致(148045 / 91947 / 13682 字节)。
 *
 * CP932 覆盖不到的字符仍然拒绝,不做替换 —— 静默换成 `?` 会悄悄改变内容,
 * 那正是本模块要防的。
 */
export type PlaintextEncodeResult = {
    ok: true;
    bytes: Uint8Array;
    encoding: PlaintextEncoding;
} | {
    ok: false;
    code: string;
    message: string;
    diagnostics: StructuredDiagnostic[];
};
export declare function encodePlaintext(text: string, encoding: PlaintextEncoding): PlaintextEncodeResult;
/** 统计紧贴文件末尾的连续 NUL 字节数。 */
export declare function trailingNulCount(bytes: Uint8Array): number;
/**
 * 把文本编成 Shift-JIS 字节。
 *
 * 遇到表里没有的字符就失败并点名是哪一个 —— 静默替换成 `?` 会让写回悄悄
 * 改变内容,而那正是本模块最初为之拒绝写入的风险。
 */
export declare function encodeShiftJis(text: string): {
    ok: true;
    bytes: Uint8Array;
} | {
    ok: false;
    char: string;
    index: number;
};
export interface ScriptRangePatch {
    /** 起始字符偏移量（含）。 */
    start: number;
    /** 终止字符偏移量（不含）。 */
    end: number;
    /** 原始切片内容（text.slice(start, end)）的 SHA-256 哈希。 */
    expectedSliceHash: string;
    /** 替换的新内容。 */
    replacement: string;
}
export type ScriptRangePatchResult = {
    ok: true;
    text: string;
    appliedCount: number;
} | {
    ok: false;
    code: string;
    message: string;
    diagnostics: StructuredDiagnostic[];
};
/**
 * 把一组不相交的 range patch 应用于原文。
 *
 * 算法保证：
 * 1. 验证所有 patch 的范围在 [0, originalText.length] 之内且 start <= end；
 * 2. 严格按 start 排序检测重叠（end > next.start 即拒绝）；
 * 3. 逐个验证切片的 SHA-256 与 expectedSliceHash 是否一致，不一致即拒绝；
 * 4. 验证通过后按 start 逆序（从后向前）应用替换，杜绝前序长度变化导致后续 offset 漂移。
 */
export declare function applyRangePatches(originalText: string, patches: readonly ScriptRangePatch[]): ScriptRangePatchResult;
