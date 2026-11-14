/**
 * Bridge 的 EMEVD 指令名占位符不是语义名。
 *
 * Bridge 的 outline / export 结果把指令名给成 `bank:<n> id:<m>`。工作区事件
 * 索引的搜索文本只取 `instruction.name`，占位符让“按指令名查事件”永远查不到：
 * `search_events {query:"DisplayMinibossHealthBar"}` 的索引路径返回 0，
 * 指令明明在 `read_emevd_event` 里读得到。
 *
 * 这里用内置 first-party EMEDF registry 把占位符还原成真实指令名；bridge 已经
 * 给出真实名字时原样保留，registry 解析不到时也保留原值——绝不编造名字。
 */
import { findInstructionDef } from './emedfSchema.js';
import { loadFirstPartyEmedfRegistry } from '../schema/sekiro/firstPartySchema.js';
const BRIDGE_PLACEHOLDER = /^bank:(\d+) id:(\d+)$/iu;
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
let registryState;
function registry() {
    if (registryState === undefined) {
        const loaded = loadFirstPartyEmedfRegistry();
        registryState = loaded.ok ? loaded.registry : null;
    }
    return registryState;
}
/**
 * 返回可搜索的指令名。输入是占位符时按 bank/id 查 first-party EMEDF；
 * 其它输入原样返回，查不到时也返回原值（不丢信息、不猜测）。
 */
export function resolveEventInstructionName(name, bank, id) {
    const raw = typeof name === 'string' ? name.trim() : '';
    const placeholder = raw === '' ? null : BRIDGE_PLACEHOLDER.exec(raw);
    if (raw !== '' && placeholder === null)
        return raw;
    const resolvedBank = placeholder ? Number(placeholder[1]) : nonNegativeInteger(bank);
    const resolvedId = placeholder ? Number(placeholder[2]) : nonNegativeInteger(id);
    const fallback = raw === '' ? undefined : raw;
    if (resolvedBank === undefined || resolvedId === undefined)
        return fallback;
    const loaded = registry();
    if (loaded === null)
        return fallback;
    return findInstructionDef(loaded, resolvedBank, resolvedId)?.name ?? fallback;
}
//# sourceMappingURL=instructionDisplayName.js.map