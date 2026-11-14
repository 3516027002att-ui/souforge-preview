import { asNumber, asRecord, asString, fail, ok, requireEditSession, resolveWorkspaceFileToken } from '../toolRegistrySupport.js';
import { parseReadOrigin, readOriginSource, resolveBaseOriginFile, workspaceRelativeOf } from '../readOrigin.js';
import { runBridge } from '../../bridge/runBridge.js';
import { modelFacingEntryName } from '../agentToolBridge.js';
/**
 * Bound the model-facing page by serialized bytes, not just by row count: a
 * chr container has entries with 120-character native names, so 512 rows is
 * already larger than the Agent envelope. The Bridge stays the native
 * authority; this only trims the tail of the page it returned and republishes
 * a truthful nextOffset.
 */
const ENTRY_PAGE_BUDGET_BYTES = 44 * 1024;
const ENTRY_ROW_OVERHEAD_BYTES = 8;
const MAX_PAGE_ROWS = 512;
function buildPage(data, offset, limit) {
    let bytes = 0;
    let count = 0;
    while (count < data.entries.length && count < limit) {
        const rowBytes = Buffer.byteLength(JSON.stringify(data.entries[count]), 'utf8') + ENTRY_ROW_OVERHEAD_BYTES;
        if (count > 0 && bytes + rowBytes > ENTRY_PAGE_BUDGET_BYTES)
            break;
        bytes += rowBytes;
        count += 1;
    }
    const entries = data.entries.slice(0, count);
    const total = data.totalCount;
    const hasMore = offset + entries.length < total;
    return {
        entries,
        offset,
        limit,
        returnedCount: entries.length,
        totalCount: total,
        remainingCount: total - offset - entries.length,
        hasMore,
        nextOffset: hasMore ? offset + entries.length : undefined,
        truncated: hasMore,
        pagination: {
            offset,
            limit,
            returnedCount: entries.length,
            totalCount: total,
            remainingCount: total - offset - entries.length,
            hasMore,
            ...(hasMore ? { nextOffset: offset + entries.length } : {})
        }
    };
}
/** list_container_entries: one domain tool declaration, schema and handler. */
export function createListContainerEntriesTool() {
    return {
        name: 'list_container_entries',
        description: 'List every entry inside a read-only BND4 or DCX container (.bnd, .bnd4, any *.bnd.dcx / *.dcx under chr, param, map, msg, action, event, menu, sfx). '
            + 'origin selects the layer: "workspace" (default) reads the opened workspace container, "base" reads the same relative container under the game base root (--base), i.e. the vanilla entry list and per-entry hashes. Every result carries source:{root,path}; a base view is read-only. '
            + 'Each row carries ordinal, id, entry name (BND4 entryName reduced to its basename), size, uncompressedSize, sha256, isCompressed and childKind. '
            + 'size/sha256 are over the entry\'s logical bytes: decompressed for entries whose flags mark them compressed, otherwise the stored bytes. '
            + 'A DCX that wraps a single non-binder file is reported as one synthetic entry with its decoded payload kind, size and sha256. '
            + 'Large containers page: pass offset/limit and follow hasMore/nextOffset; a page is trimmed by a byte budget, never silently truncated. '
            + 'Unknown or corrupt structures fail with a structured code (CONTAINER_FORMAT_UNRECOGNIZED, BND4_ENTRY_RANGE_INVALID, DCX_COMPRESSION_UNAVAILABLE, ...) instead of returning an empty list. '
            + 'Read-only: never writes or stages the container.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            offset: 'safe-integer?',
            limit: 'safe-integer?',
            origin: 'enum:workspace|base?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file);
            if (!file)
                return fail('INVALID_INPUT', 'list_container_entries 需要 file。');
            const originParse = parseReadOrigin(value.origin);
            if (!originParse.ok)
                return fail(originParse.code, originParse.message);
            const origin = originParse.origin;
            const offset = Math.trunc(asNumber(value.offset, 0));
            const limit = Math.trunc(asNumber(value.limit, MAX_PAGE_ROWS));
            if (!Number.isSafeInteger(offset) || offset < 0)
                return fail('INVALID_INPUT', 'list_container_entries 的 offset 必须是非负安全整数。');
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_ROWS)
                return fail('INVALID_INPUT', `list_container_entries 的 limit 必须是 1..${MAX_PAGE_ROWS} 的安全整数。`);
            const resolved = origin === 'base'
                ? await resolveBaseOriginFile(context, file)
                : resolveWorkspaceFileToken(context, file, { ambiguousCode: 'CONTAINER_SOURCE_AMBIGUOUS' });
            if (!resolved.ok)
                return fail(resolved.code, resolved.message, resolved.details);
            const resolvedPath = resolved.path;
            const originRelative = origin === 'base' && 'relativePath' in resolved
                ? String(resolved.relativePath)
                : undefined;
            const source = readOriginSource(origin, originRelative
                ?? workspaceRelativeOf(context, resolvedPath)
                ?? resolvedPath.replaceAll('\\', '/'));
            const result = await runBridge({
                command: 'list-bnd4-entries',
                filePath: resolvedPath,
                ...(resolved.sourceUri === undefined ? {} : { resourceUri: resolved.sourceUri }),
                allowedRoots: edit.session.allowedRoots(),
                ...(edit.session.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.session.oodleRuntimeRoot } : {}),
                commandOptions: { offset, limit },
                timeoutMs: 120_000
            });
            if (result.parseStatus === 'failed' || !result.data) {
                const diagnostic = result.diagnostics?.find((item) => item.severity === 'error') ?? result.diagnostics?.[0];
                return fail(diagnostic?.code ?? 'CONTAINER_ENTRY_LIST_FAILED', diagnostic?.message ?? '容器条目列举失败。', diagnostic?.details);
            }
            const data = result.data;
            const page = buildPage(data, offset, limit);
            // BND4 entryName 是作者构建机上的绝对路径（`N:\NTC\...\skeleton.hkx`）。
            // 模型要的是子项身份，不是作者的磁盘布局，所以每条都走与其它原生读取
            // 相同的投影规则：绝对形态只留 basename，相对名原样保留，取不到正常
            // 文件名时失败关闭为占位符。分页字节预算仍按原始行计算（更保守）。
            return ok({
                ...data,
                ...(resolved.sourceUri === undefined ? {} : { sourceUri: resolved.sourceUri }),
                source,
                entries: page.entries.map((entry) => ({ ...entry, name: modelFacingEntryName(entry.name) })),
                offset: page.offset,
                limit: page.limit,
                returnedCount: page.returnedCount,
                totalCount: page.totalCount,
                remainingCount: page.remainingCount,
                hasMore: page.hasMore,
                truncated: page.truncated,
                ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
                pagination: page.pagination
            });
        }
    };
}
// 文件 token → 宿主路径的规则与 TPF 读取器共用一条实现
// （toolRegistrySupport.resolveWorkspaceFileToken），避免两处对
// 「索引是否认得 / 绝对路径要不要回给模型」给出不同答案。
//# sourceMappingURL=list_container_entries.js.map