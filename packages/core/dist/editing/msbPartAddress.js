/**
 * read_msb_parts 的地址身份。
 *
 * MSB 允许同名 part：`m11_01_00_00.msb.dcx` 里 `c1010_0071` 有两份（0x4E3370 / 0x4F50C0）。
 * `<mapId>#<name>` 因此不是唯一标识——按地址建索引会丢条目，按名字配对会错位。
 * 这里把「怎么生成地址」和「怎么按地址选中」收成两个纯函数，读路径与写路径共用，
 * 并可以脱离 Bridge 单测。
 *
 * 别名规则：唯一名字仍输出 `<mapId>#<name>`（既有调用方一字不变）；只有重名 part
 * 追加 `@0x<offset>`，并且旧形式仍然可解析——重名时按名字解析必须报歧义，不能取第一条。
 */
import { formatMapEntityAddresses, formatMapAddress } from '@soulforge/shared';
/** nativeOffset → 该 part 的唯一地址（与索引/RAG/工具共用同一格式化函数）。 */
export function formatMsbPartAddresses(mapId, parts) {
    const addresses = formatMapEntityAddresses(mapId, parts);
    return new Map(parts.map((part, index) => [part.nativeOffset, addresses[index]]));
}
/**
 * 按地址选中 part。带 `@0x<offset>` 的地址精确命中一条；不带偏移的旧地址只在名字
 * 唯一时可用，重名时整次读取失败并列出候选（fail-closed，绝不取第一条）。
 * 返回顺序保持文档顺序，与不传地址时一致。
 */
export function selectMsbParts(mapId, parts, requests) {
    if (requests.length === 0)
        return { ok: true, parts: [...parts] };
    const addresses = formatMsbPartAddresses(mapId, parts);
    const selectedOffsets = new Set();
    const missing = [];
    const ambiguous = [];
    for (const request of requests) {
        const matches = parts.filter((part) => part.name === request.name);
        if (request.nativeOffset !== undefined) {
            const exact = matches.find((part) => part.nativeOffset === request.nativeOffset);
            if (exact === undefined)
                missing.push(request.raw);
            else
                selectedOffsets.add(exact.nativeOffset);
            continue;
        }
        if (matches.length === 0) {
            missing.push(request.raw);
            continue;
        }
        if (matches.length > 1) {
            ambiguous.push({
                address: request.raw,
                candidates: matches.map((part) => ({
                    address: addresses.get(part.nativeOffset) ?? formatMapAddress({ block: mapId, name: part.name }),
                    name: part.name,
                    nativeOffset: part.nativeOffset,
                    ...(part.typeId === undefined ? {} : { typeId: part.typeId })
                }))
            });
            continue;
        }
        selectedOffsets.add(matches[0].nativeOffset);
    }
    if (ambiguous.length > 0) {
        const lines = ambiguous.map((entry) => `${entry.address} 命中 ${entry.candidates.length} 条：`
            + entry.candidates.map((candidate) => `${candidate.address}（nativeOffset=${candidate.nativeOffset}）`).join('、'));
        return {
            ok: false,
            code: 'MSB_ADDRESS_AMBIGUOUS',
            message: `地址在地图 ${mapId} 内不唯一：${lines.join('；')}。`
                + '重名 part 必须用带 @0x 偏移的地址（即上面列出的 address）重试。',
            details: { ambiguous }
        };
    }
    if (missing.length > 0) {
        return {
            ok: false,
            code: 'MSB_PART_NOT_FOUND',
            message: `请求的 part 不存在：${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` 等 ${missing.length} 个` : ''}（文件 map ${mapId}）。`,
            details: { missing }
        };
    }
    return { ok: true, parts: parts.filter((part) => selectedOffsets.has(part.nativeOffset)) };
}
//# sourceMappingURL=msbPartAddress.js.map