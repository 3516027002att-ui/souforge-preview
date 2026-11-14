/**
 * 路径脱敏（S13）：preload 与 main 共用同一套规则 —— 只打码路径片段，
 * 保留诊断上下文。
 *
 * 旧实现两侧各写一份且都是「检测到路径就整条字符串替换」：
 * `写入失败：D:\workspace\mod\a.fmg 被占用` 会整条变成
 * `[本机路径已隐藏]`，用户看不到「写入失败…被占用」的其余语义。
 * 这里统一为片段替换：路径部分换成占位符，上下文原样保留。
 *
 * 片段终止规则：路径从盘符 / UNC / 设备前缀 / file:/// URI 起，遇到
 * 空白、引号、括号（半角/全角）、中文标点即结束 —— 路径内的汉字
 * （D:\游戏\mods\a.fmg）不终止，中文标点（。，、；：！？）终止。
 *
 * 打码 Windows、POSIX 与物理 file URI；保留相对资源 URI 和显式支持的
 * file:///workspace 逻辑命名空间，但不能通过编码或 .. 逃逸该命名空间。
 */
/** 本机路径占位符（各端共用同一文案，UI 里也按它做特殊显示）。 */
export declare const MASKED_PATH_PLACEHOLDER = "[\u672C\u673A\u8DEF\u5F84\u5DF2\u9690\u85CF]";
type BinaryPath = readonly (string | number)[];
/** Generic diagnostics are text, even when nested below a declared binary DTO. */
export declare function isRendererDiagnosticContext(key: string): boolean;
/**
 * 该 channel/path 在响应契约里是否声明为原生字节槽位 —— 只看声明，不看当前值。
 *
 * 出口投影用它区分两种情况：合法载荷（原样透传）与「占着字节槽位但不合法」。
 * 后者不能交给通用文本脱敏：`data:text/plain;base64,+/8=` 这类字符串里没有
 * 文件系统路径，maskPathFragments 会原样放行，于是 renderer 收到一个契约里
 * 从未允许的 data URI。
 */
export declare function isRendererBinaryField(channel: string, path: BinaryPath): boolean;
export declare function isRendererBinaryPayload(channel: string, path: BinaryPath, value: unknown): boolean;
/**
 * 把字符串里的本机路径片段替换为占位符，上下文原样保留。
 * 无路径时原样返回。
 */
export declare function maskPathFragments(text: string): string;
export {};
