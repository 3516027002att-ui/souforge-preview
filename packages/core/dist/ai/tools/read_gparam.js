import { asNumber, asRecord, asString, fail, ok, paginateToolRows, requireEditSession, resolveWorkspaceFileToken } from '../toolRegistrySupport.js';
import { runBridge } from '../../bridge/runBridge.js';
import { modelFacingEntryName } from '../agentToolBridge.js';
const DEFAULT_PAGE_ROWS = 256;
const MAX_PAGE_ROWS = 4096;
/**
 * read_gparam: group inventory and numeric fields of a Sekiro GPARAM bank,
 * projected from the native Bridge document (`read-gparam-document`).
 *
 * `group` is the numeric groupId the group list reports, so the model never
 * has to guess a group by position; both modes page the same way.
 *
 * A BND4 container that holds more than one `.gparam` fails closed in the
 * Bridge (`GPARAM_CONTAINER_ENTRY_AMBIGUOUS`) and lists every candidate; the
 * caller must pass `entryIndex` (or `entryName`) to pick one.
 */
export function createReadGparamTool() {
    return {
        name: 'read_gparam',
        description: 'Read a Sekiro GPARAM graphics-parameter bank (.gparam, .gparam.dcx, or one .gparam child inside a BND4 container) in two modes. '
            + 'Without group: list the groups (groupId, name1/name2, paramCount, comments). '
            + 'With group (the numeric groupId from that list): list that group\'s parameters, each with paramId, name1/name2, value type '
            + '(byte/short/int/bool/float/float2/float3/float4/byte4), typeCode, valueCount and the flattened numeric values array '
            + '(a float2/float3/float4 value contributes 2/3/4 numbers, so values.length can exceed valueCount). '
            + 'Answers: which draw/graphics groups a map bank has, and what numeric values one group holds. '
            + 'When the input is a container, `container` states which physical child was read (format, entryCount, matchingEntryCount, entryIndex, entryId, entryName, contentHash); it is absent for a loose bank. '
            + 'A container with more than one .gparam entry fails with GPARAM_CONTAINER_ENTRY_AMBIGUOUS and lists every candidate (entryIndex + entryName); retry with entryIndex. '
            + 'sourceSize/sourceHash describe the decoded GPARAM payload (a .dcx wrapper is unwrapped first). '
            + 'Paging: pass offset/limit and follow hasMore/nextOffset; a page is trimmed by a 44 KiB serialized-byte budget, never silently truncated. '
            + 'Read-only. It reports the numeric surface only: it does NOT interpret what a value means, does NOT resolve names to game behaviour, '
            + 'does NOT report GPARAM value IDs or the unmodelled blocks, and does NOT write. Non-Sekiro GPARAM (game != 5) fails with GPARAM_GAME_UNSUPPORTED; '
            + 'KRAK-compressed .gparam.dcx needs the original game root mounted for the Oodle runtime, otherwise the Bridge returns DCX_COMPRESSION_UNAVAILABLE.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            entryIndex: 'safe-integer?',
            entryName: 'string?',
            group: 'safe-integer?',
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
                return fail('INVALID_INPUT', 'read_gparam 需要 file。');
            const hasGroup = value.group !== undefined && value.group !== null;
            if (hasGroup && (typeof value.group !== 'number' || !Number.isSafeInteger(value.group) || value.group < 0))
                return fail('INVALID_INPUT', 'read_gparam 的 group 必须是非负安全整数（group 列表里的 groupId）。');
            const groupId = hasGroup ? value.group : undefined;
            const hasEntryIndex = value.entryIndex !== undefined && value.entryIndex !== null;
            if (hasEntryIndex && (typeof value.entryIndex !== 'number' || !Number.isSafeInteger(value.entryIndex) || value.entryIndex < 0))
                return fail('INVALID_INPUT', 'read_gparam 的 entryIndex 必须是非负安全整数（歧义错误 candidates 里的 entryIndex）。');
            const entryName = value.entryName === undefined || value.entryName === null ? undefined : asString(value.entryName).trim();
            if (entryName !== undefined && entryName === '')
                return fail('INVALID_INPUT', 'read_gparam 的 entryName 不能是空字符串；留空表示不按名字选择。');
            const offset = Math.trunc(asNumber(value.offset, 0));
            const limit = Math.trunc(asNumber(value.limit, DEFAULT_PAGE_ROWS));
            if (!Number.isSafeInteger(offset) || offset < 0)
                return fail('INVALID_INPUT', 'read_gparam 的 offset 必须是非负安全整数。');
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_ROWS)
                return fail('INVALID_INPUT', `read_gparam 的 limit 必须是 1..${MAX_PAGE_ROWS} 的安全整数。`);
            const resolved = resolveWorkspaceFileToken(context, file, { ambiguousCode: 'GPARAM_SOURCE_AMBIGUOUS' });
            if (!resolved.ok)
                return fail(resolved.code, resolved.message, resolved.details);
            const result = await runBridge({
                command: 'read-gparam-document',
                filePath: resolved.path,
                ...(resolved.sourceUri === undefined ? {} : { resourceUri: resolved.sourceUri }),
                allowedRoots: edit.session.allowedRoots(),
                ...(edit.session.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.session.oodleRuntimeRoot } : {}),
                // groupPage/groupPageSize = 0: the native envelope carries every
                // group; the TS page window below trims it by serialized bytes.
                // entryIndex/entryName 只在调用方给出时透传：容器多 .gparam 时
                // Bridge 失败关闭（GPARAM_CONTAINER_ENTRY_AMBIGUOUS），不替调用方挑。
                commandOptions: {
                    groupPage: 0,
                    groupPageSize: 0,
                    ...(hasEntryIndex ? { entryIndex: value.entryIndex } : {}),
                    ...(entryName === undefined ? {} : { entryName })
                },
                timeoutMs: 120_000
            });
            if (result.parseStatus === 'failed' || !result.data) {
                const diagnostic = result.diagnostics?.find((item) => item.severity === 'error') ?? result.diagnostics?.[0];
                return fail(diagnostic?.code ?? 'GPARAM_READ_FAILED', diagnostic?.message ?? 'GPARAM 读取失败。', diagnostic?.details);
            }
            const data = result.data;
            const groups = Array.isArray(data.groups) ? data.groups : [];
            const header = {
                format: data.format,
                game: data.game,
                groupCount: data.groupCount,
                sourceSize: data.sourceSize,
                sourceHash: data.sourceHash,
                authority: data.authority,
                ...(resolved.sourceUri === undefined ? {} : { sourceUri: resolved.sourceUri }),
                ...(data.container ? { container: projectGparamContainer(data.container) } : {})
            };
            if (groupId === undefined) {
                const rows = groups.map((group) => ({
                    groupId: group.groupId,
                    name1: group.name1,
                    name2: group.name2,
                    paramCount: group.paramCount,
                    comments: group.comments
                }));
                const page = paginateToolRows(rows, offset, limit);
                return ok({
                    ...header,
                    groups: page.rows,
                    ...pageWindow(page)
                });
            }
            const group = groups.find((candidate) => candidate.groupId === groupId);
            if (!group)
                return fail('GPARAM_GROUP_NOT_FOUND', `GPARAM 没有 groupId=${groupId}；groupCount=${groups.length}。`, { group: groupId, groupCount: groups.length });
            const rows = (Array.isArray(group.params) ? group.params : []).map((param) => ({
                paramId: param.paramId,
                name1: param.name1,
                name2: param.name2,
                type: param.type,
                typeCode: param.typeCode,
                valueCount: param.valueCount,
                values: param.values
            }));
            const page = paginateToolRows(rows, offset, limit);
            return ok({
                ...header,
                group: {
                    groupId: group.groupId,
                    name1: group.name1,
                    name2: group.name2,
                    paramCount: group.paramCount,
                    comments: group.comments
                },
                params: page.rows,
                ...pageWindow(page)
            });
        }
    };
}
function pageWindow(page) {
    return {
        offset: page.offset,
        limit: page.limit,
        returnedCount: page.returnedCount,
        totalCount: page.totalCount,
        remainingCount: page.remainingCount,
        hasMore: page.hasMore,
        ...(page.nextOffset === undefined ? {} : { nextOffset: page.nextOffset }),
        truncated: page.truncated,
        pagination: page.pagination
    };
}
/**
 * BND4 entry 名常是作者构建机绝对路径；给模型的容器身份只要 basename。
 * Bridge 侧已投影一次，这里再走同一投影（幂等），避免任何路径形态漏到模型上下文。
 */
function projectGparamContainer(container) {
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
//# sourceMappingURL=read_gparam.js.map