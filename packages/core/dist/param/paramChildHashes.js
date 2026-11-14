/**
 * PARAM 子表内容哈希（读证明的内容锚点）。
 *
 * 读证明记的是「某个子表的那几个字段被送达了」，绑定的是**子表自身的 sha256**
 * （`read_param_fields` 回执里每个 field 的 `sourceHash`），而不是整个 parambnd 容器。
 * 写入前必须能拿当前子表哈希跟证明里的哈希对一次：一样就说明那张表的内容确实没变
 * （例如刚被写的是同容器的另一张表），不一样就说明它变了、必须重新读。
 *
 * 锚点绑定的是**实际那张物理子表**，不是调用方拼写：一个原生类型名可以对应多张子表
 * （`BEHAVIOR_PARAM_ST` → `BehaviorParam` + `BehaviorParam_PC`），按拼写取哈希会在
 * 「一个拼写命中多张表」时给不出锚点，于是同容器写别的表之后，本表的读证明就被
 * 一刀切作废（NATIVE_READ_STALE），尽管它一个字节都没变。这里先用写入路径自己的
 * `findTableEntries` + `selectParamTableRows` 判定出真正的子表，再取那张表的哈希；
 * 判定不出来（歧义 / 行缺失 / 读取失败）仍然返回「没有锚点」，写入保持失败关闭。
 *
 * 容器里的每个 `.param` 子项是独立原生文档。未压缩存储时（Sekiro 的 parambnd 都是这样，
 * 判据是 `compressedSize === uncompressedSize`）子项存储字节就是那份原生文档本身，
 * 所以 BND4 条目哈希就等于 `read_param_fields` 报的 `sourceHash`，一次 `list-bnd4-entries`
 * 就能取到全部子表哈希。压缩存储时这个等式不成立，于是**不提供锚点**（返回 undefined），
 * 由调用方退回失败关闭语义——绝不拿一个可能永不匹配的哈希去拒绝所有写入。
 */
import { pathToFileURL } from 'node:url';
import { runBridge } from '../bridge/runBridge.js';
import { findTableEntries, resolveParamWriteTargetIdentity } from './containerParamEdit.js';
/**
 * 当前子表内容哈希，按 targets 顺序一一对应。
 *
 * 返回 `undefined` 的位置表示「这张表这次没有可用锚点」：拼写没有唯一落到一张物理子表、
 * 子项压缩存储或没有 contentHash。位置与 targets 对齐，调用方不需要再做一次表名归一化
 * （旧实现用两套不同的归一化取键，带分隔符的物理表名永远取不到）。
 */
export async function readParamChildHashes(input) {
    const targets = input.targets;
    if (targets.length === 0)
        return [];
    const usable = targets.some((target) => typeof target.table === 'string' && target.table.trim() !== '');
    if (!usable)
        return targets.map(() => undefined);
    const bridge = input.bridge ?? runBridge;
    const result = await bridge({
        command: 'list-bnd4-entries',
        filePath: input.containerPath,
        resourceUri: pathToFileURL(input.containerPath).href,
        allowedRoots: input.edit.allowedRoots(),
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        timeoutMs: 60_000,
        commandOptions: { includeContentHashes: true }
    });
    if (result.parseStatus === 'failed')
        return targets.map(() => undefined);
    const raw = result.data?.entries ?? [];
    if (raw.length === 0)
        return targets.map(() => undefined);
    const byIndex = new Map();
    const entries = [];
    for (const [position, item] of raw.entries()) {
        const name = item.name ?? '';
        if (!name.toLowerCase().endsWith('.param'))
            continue;
        const index = item.index ?? position;
        const contentHash = item.contentHash ?? '';
        if (contentHash === '')
            continue;
        byIndex.set(index, item);
        entries.push({ index, name, contentHash });
    }
    const resolveWriteTarget = input.resolveWriteTarget
        ?? (async (target) => (await resolveParamWriteTargetIdentity({
            edit: input.edit,
            containerPath: input.containerPath,
            table: target.table,
            rowIds: target.rowIds
        }))?.entryIndex);
    const hashes = [];
    for (const target of targets) {
        if (typeof target.table !== 'string' || target.table.trim() === '') {
            hashes.push(undefined);
            continue;
        }
        const candidates = findTableEntries(entries, target.table);
        let chosen = candidates.length === 1 ? candidates[0] : undefined;
        if (candidates.length > 1) {
            // 一个拼写命中多张物理子表：用这次写入真正会落到的那张表取哈希，
            // 而不是「有歧义就整张不给锚点」。
            const entryIndex = await resolveWriteTarget(target);
            chosen = entryIndex === undefined ? undefined : candidates.find((entry) => entry.index === entryIndex);
        }
        if (chosen === undefined) {
            hashes.push(undefined);
            continue;
        }
        const rawEntry = byIndex.get(chosen.index);
        // 压缩子项的 contentHash 是压缩后字节的哈希，与 read_param_fields 的 sourceHash 不同域。
        if (rawEntry === undefined || rawEntry.compressedSize !== rawEntry.uncompressedSize) {
            hashes.push(undefined);
            continue;
        }
        hashes.push(chosen.contentHash);
    }
    return hashes;
}
//# sourceMappingURL=paramChildHashes.js.map