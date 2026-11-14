import { runBridge } from '../bridge/runBridge.js';
import type { NativeEditSession } from '../editing/nativeEditSession.js';
/** 一次锚点查询：调用方拼写的表名 + 这次写入要碰的行。 */
export interface ParamChildHashTarget {
    readonly table: string;
    readonly rowIds: readonly number[];
}
/**
 * 当前子表内容哈希，按 targets 顺序一一对应。
 *
 * 返回 `undefined` 的位置表示「这张表这次没有可用锚点」：拼写没有唯一落到一张物理子表、
 * 子项压缩存储或没有 contentHash。位置与 targets 对齐，调用方不需要再做一次表名归一化
 * （旧实现用两套不同的归一化取键，带分隔符的物理表名永远取不到）。
 */
export declare function readParamChildHashes(input: {
    edit: NativeEditSession;
    containerPath: string;
    targets: readonly ParamChildHashTarget[];
    bridge?: typeof runBridge;
    /**
     * 拼写命中多张物理子表时的判定；默认走写入路径同一套
     * findTableEntries + selectParamTableRows（见 resolveParamWriteTargetIdentity）。
     */
    resolveWriteTarget?: (target: ParamChildHashTarget) => Promise<number | undefined>;
}): Promise<Array<string | undefined>>;
