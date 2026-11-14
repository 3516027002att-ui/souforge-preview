import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { asIdList, asNumber, asOptionalString, asRecord, asString, asStringList, fail, ok, requireEditSession, resolveWorkspaceFileToken } from '../toolRegistrySupport.js';
import { baseRootOf, readOriginSource, resolveBaseOriginFile } from '../readOrigin.js';
import { runBridge } from '../../bridge/runBridge.js';
import { modelFacingEntryName } from '../agentToolBridge.js';
import { readParamFields } from '../../param/containerParamEdit.js';
import { readEmevdEvent } from '../../editing/emevdEdit.js';
const MAX_DIFF_ROWS = 12;
const MAX_REPORTED_FIELD_DIFFS = 200;
const MAX_REPORTED_EVENT_DIFFS = 64;
const MAX_REPORTED_ENTRY_DIFFS = 400;
const ENTRY_PAGE_LIMIT = 512;
const MAX_ENTRY_PAGES = 4;
/** Above this the two files are not hashed; size plus structure is reported instead. */
const MAX_HASH_BYTES = 32 * 1024 * 1024;
/**
 * compare_with_base: the same file in the workspace and in the game base root.
 *
 * "Is this vanilla, or did I change it?" used to require knowing which tool to
 * read twice and doing the comparison by hand. This tool hashes both layers and,
 * when they differ, says *where*: container entries (per-child sha256), a PARAM
 * table's fields, or one EMEVD event's instructions. It reads both sides through
 * the same native readers as the read_* tools; it never invents a decoder.
 */
export function createCompareWithBaseTool(deps = {}) {
    const readFields = deps.readParamFields ?? readParamFields;
    const readEvent = deps.readEmevdEvent ?? readEmevdEvent;
    return {
        name: 'compare_with_base',
        description: 'Compare one file between the opened workspace and the game base root (--base) and say what actually differs. '
            + 'Always reports both layers\' size and sha256 and whether the bytes are identical, plus a per-entry (BND/DCX child) diff using the container listing\'s own sha256 values — so "which table/child changed" needs no decoding. '
            + 'Add table + rowIds (optional fieldIds; omitted means every field of those rows) to diff PARAM field values between the two layers: that answers "is this the original value?". '
            + 'Add eventId for an EMEVD instruction-level diff of one event: that answers "was this event like this in vanilla?". '
            + 'Result carries sources:{workspace:{root,path}, base:{root,path}}; a missing base file is reported as base.exists=false instead of failing the comparison. '
            + 'Read-only on both sides: never writes, stages or updates the workspace catalog.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            file: 'string',
            table: 'string?',
            rowIds: 'array?',
            fieldIds: 'array?',
            eventId: 'safe-integer?',
            limit: 'number?'
        },
        run: async (input, context) => {
            const value = asRecord(input);
            const file = asString(value.file).trim();
            if (!file)
                return fail('INVALID_INPUT', 'compare_with_base 需要 file（工作区相对路径，例如 event/m11_00_00_00.emevd.dcx）。');
            if (!baseRootOf(context))
                return fail('BASE_ROOT_UNAVAILABLE', 'compare_with_base 需要先挂载游戏原版目录（CLI: --base <只狼安装根目录>），否则没有可比的原版一侧。');
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const workspaceFile = resolveWorkspaceFileToken(context, file, { ambiguousCode: 'COMPARE_SOURCE_AMBIGUOUS' });
            if (!workspaceFile.ok)
                return fail(workspaceFile.code, workspaceFile.message, workspaceFile.details);
            const baseFile = await resolveBaseOriginFile(context, file);
            const relativePath = baseFile.ok ? baseFile.relativePath : file.replaceAll('\\', '/');
            const diagnostics = [];
            const workspaceInfo = await fileIdentity(workspaceFile.path, relativePath, diagnostics);
            if (!workspaceInfo.ok) {
                // A mod can delete a vanilla file. "The workspace does not have it, vanilla
                // does" is the answer, not a failed comparison.
                if (!baseFile.ok) {
                    if (baseFile.code !== 'BASE_FILE_MISSING')
                        return fail(baseFile.code, baseFile.message, baseFile.details);
                    return fail('COMPARE_FILE_MISSING', `工作区与原版目录里都没有 ${relativePath}。`);
                }
                const baseOnly = await fileIdentity(baseFile.path, relativePath, diagnostics);
                if (!baseOnly.ok)
                    return fail(baseOnly.code, baseOnly.message, baseOnly.details);
                return ok({
                    file: relativePath,
                    identical: false,
                    workspace: { exists: false, source: readOriginSource('workspace', relativePath) },
                    base: { ...baseOnly.identity, exists: true, source: readOriginSource('base', relativePath) },
                    summary: `工作区没有 ${relativePath}，原版有（${baseOnly.identity.size} 字节）：工作区缺少这个原版文件。`,
                    diagnostics
                });
            }
            if (!baseFile.ok) {
                if (baseFile.code !== 'BASE_FILE_MISSING')
                    return fail(baseFile.code, baseFile.message, baseFile.details);
                return ok({
                    file: relativePath,
                    identical: false,
                    workspace: { ...workspaceInfo.identity, exists: true, source: readOriginSource('workspace', relativePath) },
                    base: { exists: false, source: readOriginSource('base', relativePath), code: baseFile.code, message: baseFile.message },
                    summary: `工作区有 ${relativePath}，原版目录里没有这个文件：这是新增文件，原版没有可比内容。`,
                    diagnostics
                });
            }
            const baseInfo = await fileIdentity(baseFile.path, relativePath, diagnostics);
            if (!baseInfo.ok)
                return fail(baseInfo.code, baseInfo.message, baseInfo.details);
            const identical = workspaceInfo.identity.sha256 !== undefined
                && baseInfo.identity.sha256 !== undefined
                && workspaceInfo.identity.sha256 === baseInfo.identity.sha256;
            const payload = {
                file: relativePath,
                identical,
                workspace: { ...workspaceInfo.identity, exists: true, source: readOriginSource('workspace', relativePath) },
                base: { ...baseInfo.identity, exists: true, source: readOriginSource('base', relativePath) }
            };
            const summaries = [];
            if (identical) {
                summaries.push(`${relativePath} 两层字节一致（sha256 ${workspaceInfo.identity.sha256}）。`);
                return ok({ ...payload, summary: summaries.join(' '), diagnostics });
            }
            summaries.push(workspaceInfo.identity.sha256 === undefined
                ? `${relativePath} 超过 ${MAX_HASH_BYTES} 字节，未计算哈希，只按大小与结构对比。`
                : `${relativePath} 两层字节不同（工作区 ${workspaceInfo.identity.size} 字节，原版 ${baseInfo.identity.size} 字节）。`);
            const eventId = typeof value.eventId === 'number' && Number.isSafeInteger(value.eventId) ? value.eventId : undefined;
            const table = asOptionalString(value.table)?.trim();
            if (eventId !== undefined) {
                payload.eventId = eventId;
                try {
                    payload.event = await diffEvent(readEvent, edit.session, workspaceFile.path, baseFile.path, eventId);
                    summaries.push(eventSummary(payload.event));
                }
                catch (error) {
                    payload.event = { error: error instanceof Error ? error.message : String(error) };
                    summaries.push(`事件 ${eventId} 对比失败：${payload.event.error}`);
                }
            }
            else if (table) {
                const rowIds = asIdList(value.rowIds);
                if (rowIds.length === 0)
                    return fail('INVALID_INPUT', 'compare_with_base 的 table 对比需要 rowIds（最多 12 行）；不带 rowIds 时请改用不带 table 的条目级对比。');
                if (rowIds.length > MAX_DIFF_ROWS)
                    return fail('INVALID_INPUT', `compare_with_base 一次最多比较 ${MAX_DIFF_ROWS} 行，收到 ${rowIds.length} 行。`);
                const fieldIds = asStringList(value.fieldIds);
                try {
                    payload.param = await diffParamFields(readFields, edit.session, {
                        table,
                        rowIds,
                        fieldIds,
                        workspacePath: workspaceFile.path,
                        basePath: baseFile.path
                    });
                    summaries.push(paramSummary(payload.param));
                }
                catch (error) {
                    payload.param = { error: error instanceof Error ? error.message : String(error) };
                    summaries.push(`表 ${table} 对比失败：${payload.param.error}`);
                }
            }
            else {
                const limit = Math.max(1, Math.min(MAX_REPORTED_ENTRY_DIFFS, Math.trunc(asNumber(value.limit, 200))));
                try {
                    payload.entries = await diffEntries(edit.session, workspaceFile.path, baseFile.path);
                    summaries.push(entrySummary(payload.entries, limit));
                }
                catch (error) {
                    payload.entries = { error: error instanceof Error ? error.message : String(error) };
                    summaries.push(`容器条目对比失败（可能不是 BND/DCX 容器）：${payload.entries.error}`);
                }
            }
            return ok({ ...payload, summary: summaries.join(' '), diagnostics });
        }
    };
}
async function fileIdentity(path, label, diagnostics) {
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile())
        return { ok: false, code: 'COMPARE_FILE_MISSING', message: `compare_with_base 找不到文件：${label}` };
    if (info.size > MAX_HASH_BYTES)
        return { ok: true, identity: { size: info.size } };
    try {
        const sha256 = createHash('sha256').update(await readFile(path)).digest('hex');
        return { ok: true, identity: { size: info.size, sha256 } };
    }
    catch (error) {
        diagnostics.push({
            severity: 'warning',
            code: 'COMPARE_HASH_UNAVAILABLE',
            message: `无法读取文件计算哈希：${error instanceof Error ? error.message : String(error)}`
        });
        return { ok: true, identity: { size: info.size } };
    }
}
async function diffEntries(edit, workspacePath, basePath) {
    const workspaceEntries = await listEntries(edit, workspacePath);
    const baseEntries = await listEntries(edit, basePath);
    const baseByName = new Map(baseEntries.entries.map((entry) => [entry.name, entry]));
    const workspaceNames = new Set(workspaceEntries.entries.map((entry) => entry.name));
    const onlyInWorkspace = [];
    const changed = [];
    let unchanged = 0;
    for (const entry of workspaceEntries.entries) {
        const counterpart = baseByName.get(entry.name);
        if (!counterpart) {
            onlyInWorkspace.push(entry.name);
            continue;
        }
        if (counterpart.sha256 === entry.sha256) {
            unchanged += 1;
            continue;
        }
        changed.push({
            name: entry.name,
            ...(entry.sha256 ? { workspaceSha256: entry.sha256 } : {}),
            ...(counterpart.sha256 ? { baseSha256: counterpart.sha256 } : {}),
            workspaceSize: entry.size,
            baseSize: counterpart.size
        });
    }
    const onlyInBase = baseEntries.entries.filter((entry) => !workspaceNames.has(entry.name)).map((entry) => entry.name);
    return {
        workspaceEntryCount: workspaceEntries.totalCount,
        baseEntryCount: baseEntries.totalCount,
        changedEntryCount: changed.length + onlyInWorkspace.length + onlyInBase.length,
        onlyInWorkspace,
        onlyInBase,
        changed,
        unchangedEntryCount: unchanged,
        truncated: workspaceEntries.entries.length < workspaceEntries.totalCount
            || baseEntries.entries.length < baseEntries.totalCount
    };
}
async function listEntries(edit, path) {
    const entries = [];
    let totalCount = 0;
    for (let page = 0; page < MAX_ENTRY_PAGES; page += 1) {
        const result = await runBridge({
            command: 'list-bnd4-entries',
            filePath: path,
            allowedRoots: edit.allowedRoots(),
            ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {}),
            commandOptions: { offset: page * ENTRY_PAGE_LIMIT, limit: ENTRY_PAGE_LIMIT },
            timeoutMs: 120_000
        });
        if (result.parseStatus === 'failed' || !result.data) {
            const diagnostic = result.diagnostics?.find((item) => item.severity === 'error') ?? result.diagnostics?.[0];
            throw new Error(diagnostic?.message ?? '容器条目列举失败。');
        }
        const pageEntries = result.data.entries ?? [];
        entries.push(...pageEntries.map((entry) => ({
            // BND4 child names are author-machine absolute paths (N:\NTC\...); every
            // other reader ships the basename to the model, so the diff does too.
            name: modelFacingEntryName(typeof entry.name === 'string' ? entry.name : String(entry.ordinal ?? '')),
            sha256: typeof entry.sha256 === 'string' ? entry.sha256 : '',
            size: typeof entry.size === 'number' ? entry.size : 0,
            ...(typeof entry.ordinal === 'number' ? { ordinal: entry.ordinal } : {})
        })));
        totalCount = typeof result.data.totalCount === 'number' ? result.data.totalCount : entries.length;
        if (result.data.hasMore !== true || pageEntries.length === 0)
            break;
    }
    return { entries, totalCount };
}
async function diffParamFields(readFields, edit, input) {
    // readParamFields pages its cells, so one call only sees the first window. Follow the
    // cursor to exhaustion: a single window made a 350-field row look like 32 identical
    // fields and reported "0 changed" for a value that really changed.
    const readSide = async (containerPath) => {
        const fields = [];
        let cursor;
        let complete = false;
        for (let page = 0; page < 64; page += 1) {
            const result = await readFields({
                edit,
                queries: [{ table: input.table, rowIds: input.rowIds, fieldIds: input.fieldIds }],
                containerPath,
                pageSize: 128,
                ...(cursor === undefined ? {} : { cursor })
            });
            if (!result.ok)
                throw new Error(`${result.error.code}: ${result.error.message}`);
            fields.push(...result.fields);
            const next = result.pagination?.nextCursor ?? undefined;
            if (!next) {
                complete = true;
                break;
            }
            cursor = next;
        }
        return { fields, complete };
    };
    const workspace = await readSide(input.workspacePath);
    const base = await readSide(input.basePath);
    /** `${rowId}@${rowIndex}` → that physical row's field values. */
    const physicalRows = (fields) => {
        const rows = new Map();
        for (const field of fields) {
            const key = `${field.rowId}@${field.rowIndex ?? '?'}`;
            const values = rows.get(key) ?? new Map();
            values.set(field.fieldId ?? '', field.value);
            rows.set(key, values);
        }
        return rows;
    };
    const keysByRowId = (rows) => {
        const grouped = new Map();
        for (const key of rows.keys()) {
            const rowId = Number(key.slice(0, key.indexOf('@')));
            const list = grouped.get(rowId) ?? [];
            list.push(key);
            grouped.set(rowId, list);
        }
        return grouped;
    };
    const rowIndexFromKey = (key) => {
        const raw = key.slice(key.indexOf('@') + 1);
        return raw === '?' ? undefined : Number(raw);
    };
    const workspaceRows = physicalRows(workspace.fields);
    const baseRows = physicalRows(base.fields);
    const workspaceKeys = keysByRowId(workspaceRows);
    const baseKeys = keysByRowId(baseRows);
    const changedFields = [];
    const rowsOnlyInWorkspace = [];
    const rowsOnlyInBase = [];
    const rowsWithDuplicatePhysicalIdentity = [];
    let identicalFieldCount = 0;
    let cellsCompared = 0;
    let truncated = false;
    for (const rowId of input.rowIds) {
        const workspaceRowKeys = workspaceKeys.get(rowId);
        const baseRowKeys = baseKeys.get(rowId);
        if (!workspaceRowKeys || workspaceRowKeys.length === 0) {
            if (baseRowKeys && baseRowKeys.length > 0)
                rowsOnlyInBase.push(rowId);
            continue;
        }
        if (!baseRowKeys || baseRowKeys.length === 0) {
            rowsOnlyInWorkspace.push(rowId);
            continue;
        }
        if (workspaceRowKeys.length > 1 || baseRowKeys.length > 1)
            rowsWithDuplicatePhysicalIdentity.push(rowId);
        const workspaceKey = workspaceRowKeys[0];
        const baseKey = baseRowKeys[0];
        const workspaceValues = workspaceRows.get(workspaceKey) ?? new Map();
        const baseValues = baseRows.get(baseKey) ?? new Map();
        const workspaceIndex = rowIndexFromKey(workspaceKey);
        const baseIndex = rowIndexFromKey(baseKey);
        const indexChanged = workspaceIndex !== baseIndex;
        for (const fieldId of new Set([...workspaceValues.keys(), ...baseValues.keys()])) {
            const workspaceValue = workspaceValues.get(fieldId);
            const baseValue = baseValues.get(fieldId);
            cellsCompared += 1;
            if (JSON.stringify(baseValue) === JSON.stringify(workspaceValue)) {
                identicalFieldCount += 1;
                continue;
            }
            if (changedFields.length >= MAX_REPORTED_FIELD_DIFFS) {
                truncated = true;
                continue;
            }
            changedFields.push({
                rowId,
                fieldId,
                workspace: workspaceValue ?? null,
                base: baseValue ?? null,
                ...(indexChanged
                    ? {
                        rowIndex: {
                            ...(workspaceIndex === undefined ? {} : { workspace: workspaceIndex }),
                            ...(baseIndex === undefined ? {} : { base: baseIndex })
                        }
                    }
                    : {})
            });
        }
    }
    return {
        table: input.table,
        changedFieldCount: changedFields.length,
        identicalFieldCount,
        cellsCompared,
        complete: workspace.complete && base.complete,
        changedFields,
        rowsOnlyInWorkspace,
        rowsOnlyInBase,
        rowsWithDuplicatePhysicalIdentity,
        truncated
    };
}
/** Above this many index pairs the quadratic alignment is skipped (a huge event). */
const MAX_ALIGNMENT_CELLS = 1_000_000;
async function diffEvent(readEvent, edit, workspacePath, basePath, eventId) {
    const read = async (path) => {
        const result = await readEvent({ edit, file: path, eventId, format: 'json' });
        if (!result.ok)
            throw new Error(`${result.error?.code ?? 'EMEVD_READ_FAILED'}: ${result.error?.message ?? '事件读取失败'}`);
        return result.instructions ?? [];
    };
    const workspace = await read(workspacePath);
    const base = await read(basePath);
    const signature = (instruction) => instruction === undefined
        ? '<missing>'
        : `${instruction.bank ?? '?'}:${instruction.id ?? '?'}:${instruction.argsBase64 ?? ''}`;
    const length = Math.max(workspace.length, base.length);
    const changed = [];
    for (let index = 0; index < length; index += 1) {
        const workspaceInstruction = workspace[index];
        const baseInstruction = base[index];
        if (signature(workspaceInstruction) === signature(baseInstruction))
            continue;
        if (changed.length >= MAX_REPORTED_EVENT_DIFFS)
            break;
        changed.push({
            index,
            ...(workspaceInstruction ? { workspace: workspaceInstruction } : {}),
            ...(baseInstruction ? { base: baseInstruction } : {})
        });
    }
    // Index alignment alone turns one inserted instruction into "every following line
    // changed" (an 18-vs-19-instruction event read as 13 differences). Align on the
    // longest common subsequence so the answer names what was inserted or removed.
    const alignment = workspace.length * base.length <= MAX_ALIGNMENT_CELLS
        ? alignInstructions(workspace, base, signature)
        : undefined;
    return {
        workspaceInstructionCount: workspace.length,
        baseInstructionCount: base.length,
        changedInstructionCount: changed.length,
        changed,
        onlyInWorkspace: alignment?.onlyInWorkspace ?? [],
        onlyInBase: alignment?.onlyInBase ?? [],
        alignment: alignment === undefined ? 'index' : 'lcs',
        truncated: changed.length >= MAX_REPORTED_EVENT_DIFFS
            || (alignment !== undefined
                && (alignment.onlyInWorkspace.length + alignment.onlyInBase.length) >= MAX_REPORTED_EVENT_DIFFS)
    };
}
function alignInstructions(workspace, base, signature) {
    const rows = workspace.length;
    const columns = base.length;
    const lcs = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
    for (let row = rows - 1; row >= 0; row -= 1) {
        for (let column = columns - 1; column >= 0; column -= 1) {
            lcs[row][column] = signature(workspace[row]) === signature(base[column])
                ? lcs[row + 1][column + 1] + 1
                : Math.max(lcs[row + 1][column], lcs[row][column + 1]);
        }
    }
    const onlyInWorkspace = [];
    const onlyInBase = [];
    let row = 0;
    let column = 0;
    while (row < rows && column < columns) {
        if (signature(workspace[row]) === signature(base[column])) {
            row += 1;
            column += 1;
            continue;
        }
        if (lcs[row + 1][column] >= lcs[row][column + 1]) {
            onlyInWorkspace.push({ index: row, ...workspace[row] });
            row += 1;
        }
        else {
            onlyInBase.push({ index: column, ...base[column] });
            column += 1;
        }
    }
    while (row < rows) {
        onlyInWorkspace.push({ index: row, ...workspace[row] });
        row += 1;
    }
    while (column < columns) {
        onlyInBase.push({ index: column, ...base[column] });
        column += 1;
    }
    return { onlyInWorkspace, onlyInBase };
}
function entrySummary(diff, limit) {
    if ('error' in diff)
        return `条目级对比不可用：${diff.error}`;
    const names = [...diff.onlyInWorkspace.map((name) => `+${name}`), ...diff.onlyInBase.map((name) => `-${name}`)]
        .slice(0, limit);
    return `容器条目：工作区 ${diff.workspaceEntryCount} / 原版 ${diff.baseEntryCount}，`
        + `仅工作区 ${diff.onlyInWorkspace.length}、仅原版 ${diff.onlyInBase.length}、内容不同 ${diff.changed.length}、相同 ${diff.unchangedEntryCount}。`
        + (names.length > 0 ? ` 差异子项：${names.join(', ')}。` : '')
        + (diff.truncated ? ' 条目列表超过扫描上限，只对比了已列出的部分。' : '');
}
function paramSummary(diff) {
    if ('error' in diff)
        return `字段级对比不可用：${diff.error}`;
    const names = diff.changedFields.slice(0, 8).map((field) => `${field.fieldId}(${field.rowId}): 工作区 ${JSON.stringify(field.workspace)} → 原版 ${JSON.stringify(field.base)}`);
    return `表 ${diff.table}：比较 ${diff.cellsCompared} 个字段格，不同 ${diff.changedFieldCount}、相同 ${diff.identicalFieldCount}。`
        + (names.length > 0 ? ` 例如 ${names.join('；')}。` : '')
        + (diff.complete ? '' : ' 读取窗口没有走完，结论只覆盖已比较的字段。')
        + (diff.rowsOnlyInWorkspace.length > 0 ? ` 仅工作区行：${diff.rowsOnlyInWorkspace.slice(0, 8).join(', ')}。` : '')
        + (diff.rowsOnlyInBase.length > 0 ? ` 仅原版行：${diff.rowsOnlyInBase.slice(0, 8).join(', ')}。` : '')
        + (diff.rowsWithDuplicatePhysicalIdentity.length > 0
            ? ` 这些逻辑行在某一层有多条物理行，只比了第一条：${diff.rowsWithDuplicatePhysicalIdentity.slice(0, 8).join(', ')}。`
            : '')
        + (diff.truncated ? ' 差异清单已截断。' : '');
}
function eventSummary(diff) {
    if ('error' in diff)
        return `事件级对比不可用：${diff.error}`;
    const workspaceOnly = diff.onlyInWorkspace.slice(0, 6).map((item) => `#${item.index} ${item.emedfName ?? item.bank + ':' + item.id}`);
    const baseOnly = diff.onlyInBase.slice(0, 6).map((item) => `#${item.index} ${item.emedfName ?? item.bank + ':' + item.id}`);
    if (diff.alignment === 'lcs') {
        return `事件指令：工作区 ${diff.workspaceInstructionCount} 条 / 原版 ${diff.baseInstructionCount} 条。`
            + (workspaceOnly.length > 0 ? ` 仅工作区：${workspaceOnly.join('、')}。` : '')
            + (baseOnly.length > 0 ? ` 仅原版：${baseOnly.join('、')}。` : '')
            + (workspaceOnly.length === 0 && baseOnly.length === 0 ? ' 指令序列一致。' : '')
            + (diff.truncated ? ' 差异清单已截断。' : '');
    }
    const names = diff.changed.slice(0, 8).map((item) => `#${item.index} 工作区 ${item.workspace?.emedfName ?? '（无）'} → 原版 ${item.base?.emedfName ?? '（无）'}`);
    return `事件指令：工作区 ${diff.workspaceInstructionCount} 条 / 原版 ${diff.baseInstructionCount} 条，不同 ${diff.changedInstructionCount} 条。`
        + (names.length > 0 ? ` 例如 ${names.join('；')}。` : '')
        + (diff.truncated ? ' 差异清单已截断。' : '');
}
//# sourceMappingURL=compare_with_base.js.map