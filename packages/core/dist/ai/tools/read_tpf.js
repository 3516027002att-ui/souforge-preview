import { asNumber, asRecord, asString, fail, ok, paginateToolRows, requireEditSession, resolveWorkspaceFileToken } from '../toolRegistrySupport.js';
import { runBridge } from '../../bridge/runBridge.js';
import { modelFacingEntryName } from '../agentToolBridge.js';
const DEFAULT_PAGE_ROWS = 512;
const MAX_PAGE_ROWS = 4096;
/**
 * read_tpf: texture inventory of a TPF package, projected from the native
 * Bridge document (`read-tpf-document`). The TypeScript side owns the page
 * window and the model-facing field names; it never parses TPF bytes.
 *
 * A BND4/DCX container that holds more than one `.tpf` fails closed in the
 * Bridge (`TPF_CONTAINER_ENTRY_AMBIGUOUS`) and lists every candidate; the
 * caller must pass `entryIndex` (or `entryName`) to pick one. This tool never
 * silently reads "the first" package.
 */
export function createReadTpfTool() {
    return {
        name: 'read_tpf',
        description: 'Read a Sekiro TPF texture package (.tpf, .tpf.dcx, or one .tpf child inside a BND4/DCX container) and list its texture entries. '
            + 'Each row carries the texture index, name, format (BC1/BC1-alpha/BC4/BC5/...), formatByte, width, height, stored size in bytes, and mipmapCount. '
            + 'Answers: which textures are inside one package and what their dimensions/format are. '
            + 'When the input is a container, `container` states which physical child was read (format, entryCount, matchingEntryCount, entryIndex, entryId, entryName, contentHash); it is absent for a loose TPF, so "no container" is never confused with "entry 0". '
            + 'A container with more than one .tpf entry fails with TPF_CONTAINER_ENTRY_AMBIGUOUS and lists every candidate (entryIndex + entryName); retry with entryIndex. '
            + 'Reads the native entry-table mode: the TPF header, entry table, names and each texture\'s 128-byte DDS header only. Pixel data is never loaded, '
            + 'so a package whose decoded payload exceeds the native 256 MiB full-read bound (e.g. the 274 MiB menu/hi/01_common.tpf.dcx) still lists completely; '
            + 'the same mode means no no-op rebuild/roundtrip verification, which pixel-level commands (export/preview) still perform under their own bound. '
            + 'sourceSize/sourceHash describe the decoded TPF payload (a .dcx wrapper is unwrapped first), not the on-disk .dcx size. '
            + 'Paging: pass offset/limit and follow hasMore/nextOffset; a page is trimmed by a 44 KiB serialized-byte budget, never silently truncated. '
            + 'Read-only. It does NOT decode DDS pixels, does NOT export or preview images, does NOT report per-mip dimensions, and does NOT modify the package. '
            + 'A payload that is not a DDS blob, or an unsupported container, fails with the Bridge TPF code instead of guessing.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            entryIndex: 'safe-integer?',
            entryName: 'string?',
            offset: 'safe-integer?',
            limit: 'safe-integer?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const file = asString(value.file).trim();
            if (!file)
                return fail('INVALID_INPUT', 'read_tpf 需要 file。');
            const hasEntryIndex = value.entryIndex !== undefined && value.entryIndex !== null;
            if (hasEntryIndex && (typeof value.entryIndex !== 'number' || !Number.isSafeInteger(value.entryIndex) || value.entryIndex < 0))
                return fail('INVALID_INPUT', 'read_tpf 的 entryIndex 必须是非负安全整数（歧义错误 candidates 里的 entryIndex）。');
            const entryName = value.entryName === undefined || value.entryName === null ? undefined : asString(value.entryName).trim();
            if (entryName !== undefined && entryName === '')
                return fail('INVALID_INPUT', 'read_tpf 的 entryName 不能是空字符串；留空表示不按名字选择。');
            const offset = Math.trunc(asNumber(value.offset, 0));
            const limit = Math.trunc(asNumber(value.limit, DEFAULT_PAGE_ROWS));
            if (!Number.isSafeInteger(offset) || offset < 0)
                return fail('INVALID_INPUT', 'read_tpf 的 offset 必须是非负安全整数。');
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_ROWS)
                return fail('INVALID_INPUT', `read_tpf 的 limit 必须是 1..${MAX_PAGE_ROWS} 的安全整数。`);
            const resolved = resolveWorkspaceFileToken(context, file, { ambiguousCode: 'TPF_SOURCE_AMBIGUOUS' });
            if (!resolved.ok)
                return fail(resolved.code, resolved.message, resolved.details);
            const result = await runBridge({
                command: 'read-tpf-document',
                filePath: resolved.path,
                ...(resolved.sourceUri === undefined ? {} : { resourceUri: resolved.sourceUri }),
                allowedRoots: edit.session.allowedRoots(),
                ...(edit.session.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.session.oodleRuntimeRoot } : {}),
                // 条目表模式：只读头/条目表/名称/DDS 头，不驻留像素；274 MiB 的
                // 01_common.tpf.dcx 因此不再撞 256 MiB 整块上限。解压本身仍要几秒。
                // entryIndex/entryName 只在调用方给出时透传：容器多 .tpf 时 Bridge
                // 会失败关闭而不是替调用方挑第一个。
                commandOptions: {
                    entryTableOnly: true,
                    ...(hasEntryIndex ? { entryIndex: value.entryIndex } : {}),
                    ...(entryName === undefined ? {} : { entryName })
                },
                timeoutMs: 180_000
            });
            if (result.parseStatus === 'failed' || !result.data) {
                const diagnostic = result.diagnostics?.find((item) => item.severity === 'error') ?? result.diagnostics?.[0];
                return fail(diagnostic?.code ?? 'TPF_READ_FAILED', diagnostic?.message ?? 'TPF 读取失败。', diagnostic?.details);
            }
            const data = result.data;
            const rows = (Array.isArray(data.textures) ? data.textures : []).map((texture) => ({
                index: texture.index,
                // TPF 名称通常是短名；走同一投影后，万一携带构建机绝对路径也不会回给模型。
                name: modelFacingEntryName(texture.name),
                format: texture.format,
                formatByte: texture.formatByte,
                width: texture.width,
                height: texture.height,
                size: texture.dataSize,
                mipmapCount: texture.mipCount
            }));
            const page = paginateToolRows(rows, offset, limit);
            return ok({
                format: data.format,
                sourceSize: data.sourceSize,
                sourceHash: data.sourceHash,
                textureCount: data.textureCount,
                platform: data.platform,
                encoding: data.encoding,
                flags: data.flags,
                authority: data.authority,
                ...(resolved.sourceUri === undefined ? {} : { sourceUri: resolved.sourceUri }),
                ...(data.container ? { container: projectTpfContainer(data.container) } : {}),
                textures: page.rows,
                offset: page.offset,
                limit: page.limit,
                returnedCount: page.returnedCount,
                totalCount: page.totalCount,
                remainingCount: page.remainingCount,
                hasMore: page.hasMore,
                ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
                truncated: page.truncated,
                pagination: page.pagination
            });
        }
    };
}
/**
 * BND4 entry 名常是作者构建机绝对路径；给模型的容器身份只要 basename。
 * Bridge 侧已投影一次，这里再走同一投影（幂等），避免任何路径形态漏到模型上下文。
 */
function projectTpfContainer(container) {
    return {
        containerPath: container.containerPath,
        containerFormat: container.containerFormat,
        entryCount: container.entryCount,
        matchingEntryCount: container.matchingEntryCount,
        entryIndex: container.entryIndex,
        entryId: container.entryId,
        entryName: modelFacingEntryName(container.entryName),
        duplicateOrdinal: container.duplicateOrdinal,
        contentHash: container.contentHash
    };
}
//# sourceMappingURL=read_tpf.js.map