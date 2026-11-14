/**
 * Minimal synthetic Sekiro EMEVD binary builder for smoke fixtures.
 *
 * Layout mirrors bridge/SoulForge.Bridge/EmevdNativeDocument.cs:
 * - header 0x90 (EVD\0 + 00 FF 01 FF + version 0xCD + i64 varints)
 * - event table 0x30/entry, instruction table 0x20/entry
 * - args bank: 4-byte aligned blobs, then 0x10-padded
 * - parameters/linked/strings empty
 *
 * Explicitly synthetic and tiny; never a game asset and never claims
 * native corpus authority.
 */
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
export interface SyntheticEmevdInstructionSpec {
    bank: number;
    id: number;
    args: Buffer;
}
export interface SyntheticEmevdEventSpec {
    id: number;
    restBehavior: number;
    instructions: SyntheticEmevdInstructionSpec[];
}
export declare function buildSyntheticEmevd(events: SyntheticEmevdEventSpec[]): Buffer;
/** Standard two-event smoke fixture used by EMEVD plan commit smokes. */
export declare function standardSyntheticEmevd(): Buffer;
/**
 * {@link standardSyntheticEmevd} 的等长变体：instruction 0 的 args 换成
 * {@link mutatedWaitForArgs}（-1 → -2），只差一个字节，文件长度不变。
 *
 * 缓存身份回归用它模拟外部工具「等长改写 + 回写原 mtime」：mtime 与 length 两个字段
 * 都不动，只有内容变了。旧的 (path, mtime, length) 键在这一形态下会命中旧内容。
 */
export declare function standardSyntheticEmevdEqualLengthVariant(): Buffer;
/**
 * 大体积 synthetic EMEVD：并发行为回归专用。
 *
 * 「两个不同文件不得在全局锁上串行」要观测到两次解析的**时间窗口重叠**。
 * 368 字节的标准 fixture 解析加往返校验不到 1 ms，重叠靠碰运气；两份都放大到
 * 数万条指令，解析窗口才宽到必然重叠，判据也才能只看峰值计数、不看时钟。
 *
 * `salt` 只改 arg 字节，不改任何长度或表结构：两份文件因此内容不同（各自独立的
 * 缓存身份、必须各解析一次），但规模完全一致 —— 不会出现一份大一份小、
 * 小的那份先跑完导致窗口不重叠。
 */
export declare function largeSyntheticEmevd(options: {
    events: number;
    instructionsPerEvent: number;
    salt: number;
}): Buffer;
/** Args bank of instruction 0 after the canonical plan-commit DSL patch (conditionGroup -1 → -2). */
export declare function mutatedWaitForArgs(): Buffer;
/** Args bank of instruction 1 after the canonical plan-commit DSL patch (resultConditionGroup=5, desiredComparisonType=1). */
export declare function mutatedIfCondArgs(): Buffer;
/**
 * Minimal DarkScript3-format EMEDF JSON constructed by us for smoke tests.
 * Three instructions:
 *   - 0:0   IfConditionGroup   {s8, u8, s8}  → 4-byte payload
 *   - 2000:0 InitializeEvent    {s32, u32, u32 vararg} → 8-byte base + 4-byte stride
 *   - 2003:1 EndEvent           {}            → 0-byte payload
 * The claimed lengths match the real corpus distribution (0:0 → 4 bytes,
 * 2000:0 → 12/16/20/24/32 all valid vararg multiples), so the imported
 * registry can drive typed mutations against real documents.
 */
export declare function createSyntheticDs3EmedfJson(): string;
/** Import the synthetic DarkScript3-format JSON through the external adapter. */
export declare function createSyntheticImportedEmedf(): EmedfRegistry;
/** Expected args bank of the 0:0 instruction after the imported-registry DSL patch. */
export declare function mutatedIfCondArgsForImported(): Buffer;
/** Expected args bank of the 2000:0 instruction after the imported-registry DSL patch. */
export declare function mutatedInitEventArgsForImported(): Buffer;
/** Synthetic EMEVD matching the imported synthetic DS3 schema (see above). */
export declare function importedRegistrySyntheticEmevd(): Buffer;
export declare function sha256Hex(bytes: Buffer): string;
