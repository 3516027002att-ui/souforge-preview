/**
 * Agent / CLI FMG facade.
 *
 * Reads live text via read-text-catalog (confirmed tables only) and writes
 * through write-fmg mutations[] + applyNativeMutation. msgbnd never falls
 * back to a loose FMG write.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { logicalFmgTableName } from '@soulforge/shared';
import { fmgTableNeedles } from './fmgTableNames.js';
import { runBridge } from '../bridge/runBridge.js';
import { applyNativeMutation } from './editorMutationService.js';
import { commitFmgMultiTableViaBridge } from './fmgBridgeCommit.js';
/** 用户口语 / 英文表名 → 本机 BND 逻辑名（只狼 zhocn 包是日文文件名）。 */
function tableNeedles(wanted) {
    return fmgTableNeedles(wanted);
}
export function groupFmgEdits(edits) {
    const groups = new Map();
    for (const edit of edits) {
        const key = edit.table.trim().toLowerCase();
        const list = groups.get(key) ?? [];
        list.push(edit);
        groups.set(key, list);
    }
    return groups;
}
export async function readFmgEntries(input) {
    if (input.ids.length === 0) {
        return { ok: false, error: { code: 'FMG_READ_EMPTY', message: '需要至少一个 id。' }, diagnostics: [] };
    }
    const resolved = await resolveFmgTable(input.edit, input.table, input.containerPath, input.lang);
    if (!resolved.ok)
        return resolved;
    const loaded = await loadTableEntries(input.edit, resolved);
    let sourceRevision;
    try {
        sourceRevision = (await stat(resolved.containerPath)).mtimeMs;
    }
    catch (error) {
        loaded.diagnostics.push({
            severity: 'warning',
            code: 'FMG_SOURCE_REVISION_UNAVAILABLE',
            message: error instanceof Error ? error.message : '无法读取 FMG 容器的 source revision。'
        });
    }
    if (!loaded.ok)
        return loaded;
    const entries = [];
    const missingIds = [];
    for (const id of input.ids) {
        const text = loaded.byId.get(id);
        if (text === undefined) {
            missingIds.push(id);
            continue;
        }
        entries.push({
            table: resolved.table,
            id,
            text,
            ...(resolved.outerHash ? { sourceHash: resolved.outerHash } : {}),
            ...(sourceRevision !== undefined ? { sourceRevision } : {})
        });
    }
    if (entries.length === 0 && input.ids.length > 0) {
        return {
            ok: false,
            error: { code: 'FMG_ENTRY_NOT_FOUND', message: `${resolved.table}#${input.ids.join(', ')} 均不存在。` },
            diagnostics: loaded.diagnostics
        };
    }
    const diagnostics = [...loaded.diagnostics];
    if (missingIds.length > 0) {
        // A diagnostic that echoes every missing id is itself unbounded caller input:
        // a 4000-id typo list used to be copied back verbatim. Report the count and a
        // bounded sample — the caller already knows what it sent.
        const MISSING_ID_ECHO_LIMIT = 50;
        diagnostics.push({
            severity: 'warning',
            code: 'FMG_ENTRY_PARTIAL_MISSING',
            message: `${resolved.table} 未找到 ${missingIds.length} 个 ID：${missingIds.slice(0, MISSING_ID_ECHO_LIMIT).join(', ')}${missingIds.length > MISSING_ID_ECHO_LIMIT ? ` …（其余 ${missingIds.length - MISSING_ID_ECHO_LIMIT} 个省略）` : ''}。`
        });
    }
    return {
        ok: true,
        containerPath: resolved.containerPath,
        table: resolved.table,
        entries,
        diagnostics
    };
}
/**
 * 整表条目集的一页：只由能自述「这一页覆盖整表哪些条目序号 + 全表共多少条目」的读取铸造
 * 容器级证明。`read_fmg_entries` 的 ids 读一次只交付调用方点名的条目，无法证明整表，
 * 因此新增条目的回退授权必须来自这里的分页枚举。
 */
export async function readFmgEntryPage(input) {
    const resolved = await resolveFmgTable(input.edit, input.table, input.containerPath, input.lang);
    if (!resolved.ok)
        return resolved;
    const loaded = await loadTableEntries(input.edit, resolved);
    if (!loaded.ok)
        return loaded;
    let sourceRevision;
    try {
        sourceRevision = (await stat(resolved.containerPath)).mtimeMs;
    }
    catch (error) {
        loaded.diagnostics.push({
            severity: 'warning',
            code: 'FMG_SOURCE_REVISION_UNAVAILABLE',
            message: error instanceof Error ? error.message : '无法读取 FMG 容器的 source revision。'
        });
    }
    // The catalog map preserves the native entry order; the ordinal is the coverage unit, not the id.
    const ordered = [...loaded.byId.entries()];
    const entryCount = ordered.length;
    const entryOffset = input.offset ?? 0;
    if (!Number.isSafeInteger(entryOffset) || entryOffset < 0 || entryOffset > entryCount) {
        return {
            ok: false,
            error: {
                code: 'FMG_ENTRY_OFFSET_OUT_OF_RANGE',
                message: `offset ${String(input.offset)} 超出整表条目数 ${entryCount}。`,
                details: { offset: input.offset, entryCount }
            },
            diagnostics: loaded.diagnostics
        };
    }
    const entryLimit = Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 512 ? input.limit : 256;
    const slice = ordered.slice(entryOffset, entryOffset + entryLimit);
    const entries = slice.map(([id, text], position) => ({
        table: resolved.table,
        id,
        text,
        entryIndex: entryOffset + position,
        ...(resolved.outerHash ? { sourceHash: resolved.outerHash } : {}),
        ...(sourceRevision !== undefined ? { sourceRevision } : {})
    }));
    const nextOffset = entryOffset + entries.length;
    const hasMore = nextOffset < entryCount;
    return {
        ok: true,
        containerPath: resolved.containerPath,
        table: resolved.table,
        entryCount,
        entryOffset,
        entryLimit,
        entryReturned: entries.length,
        hasMore,
        ...(hasMore ? { nextOffset } : {}),
        entries,
        ...(resolved.outerHash ? { sourceHash: resolved.outerHash } : {}),
        ...(sourceRevision !== undefined ? { sourceRevision } : {}),
        diagnostics: loaded.diagnostics
    };
}
export async function setFmgEntries(input) {
    if (input.edits.length === 0) {
        return { ok: false, error: { code: 'FMG_EDIT_EMPTY', message: '没有要写入的词条。' }, diagnostics: [] };
    }
    const grouped = groupFmgEdits(input.edits);
    const resolvedTables = [];
    let commonContainer;
    const allDiagnostics = [];
    for (const [tableName, edits] of grouped.entries()) {
        const resolved = await resolveFmgTable(input.edit, tableName, input.containerPath, input.lang);
        if (!resolved.ok)
            return resolved;
        if (commonContainer === undefined) {
            commonContainer = resolved.containerPath;
        }
        else if (commonContainer !== resolved.containerPath) {
            return {
                ok: false,
                error: {
                    code: 'FMG_CROSS_CONTAINER',
                    message: `一次原子提交只支持同一个容器内的表修改；收到不同容器：${commonContainer} 与 ${resolved.containerPath}`
                },
                diagnostics: allDiagnostics
            };
        }
        resolvedTables.push({
            table: resolved.table,
            containerPath: resolved.containerPath,
            entryIndex: resolved.entryIndex,
            outerHash: resolved.outerHash,
            edits
        });
    }
    const containerPath = commonContainer;
    const before = [];
    const after = [];
    const tableBatches = [];
    for (const t of resolvedTables) {
        const loaded = await loadTableEntries(input.edit, t);
        if (!loaded.ok)
            return { ok: false, error: loaded.error, diagnostics: loaded.diagnostics };
        allDiagnostics.push(...loaded.diagnostics);
        const mutations = [];
        for (const edit of t.edits) {
            const current = loaded.byId.get(edit.id);
            const slotOpt = edit.slotIndex !== undefined ? { slotIndex: edit.slotIndex } : {};
            if (current === undefined) {
                after.push({ table: t.table, id: edit.id, text: edit.text, ...slotOpt });
                mutations.push({ kind: 'add', id: edit.id, text: edit.text, ...slotOpt });
                continue;
            }
            before.push({ table: t.table, id: edit.id, text: current, ...slotOpt });
            after.push({ table: t.table, id: edit.id, text: edit.text, ...slotOpt });
            mutations.push({ kind: 'upsert', id: edit.id, text: edit.text, ...slotOpt });
        }
        if (mutations.length > 0) {
            tableBatches.push({
                entryIndex: t.entryIndex,
                mutations
            });
        }
    }
    if (tableBatches.length === 0) {
        return {
            ok: true,
            containerPath,
            before,
            after,
            diagnostics: allDiagnostics
        };
    }
    const file = await input.edit.indexFile(containerPath, 'msg');
    const expectedHash = resolvedTables[0]?.outerHash || file.sha256 || await sha256Of(containerPath);
    const totalMutations = tableBatches.reduce((acc, b) => acc + b.mutations.length, 0);
    const outcome = await applyNativeMutation({
        file: { ...file, sha256: expectedHash },
        sourceUri: file.sourceUri,
        expectedHash,
        stagingRoot: input.edit.stagingRoot,
        allowedRoots: () => [...input.edit.allowedRoots()],
        stagingPrefix: 'fmg',
        stagingFileName: `${basename(containerPath)}.mut.fmg`,
        stageWrite: (context) => commitFmgMultiTableViaBridge({
            sourcePath: containerPath,
            outputPath: context.outputPath,
            expectedDocumentHash: expectedHash,
            allowedRoots: context.allowedRoots,
            writableRoots: context.writableRoots,
            tables: tableBatches,
            disallowAmbiguous: true,
            timeoutMs: 120_000,
            ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
        }),
        title: `FMG mut ${totalMutations} across ${tableBatches.length} tables in ${basename(containerPath)}`,
        confirmActionLabel: '提交 FMG 变更'
    }, { commit: input.edit.commitPort });
    if (outcome.status !== 'committed' || !outcome.result.ok) {
        const diagnostics = outcome.status === 'failed'
            ? outcome.diagnostics
            : outcome.status === 'committed'
                ? outcome.result.diagnostics
                : [{
                        severity: 'error',
                        code: 'FMG_WRITE_CANCELLED',
                        message: '写入被取消。',
                        sourceUri: file.sourceUri
                    }];
        return {
            ok: false,
            error: { code: diagnostics[0]?.code ?? 'FMG_WRITE_FAILED', message: diagnostics[0]?.message ?? 'FMG 写入失败。' },
            diagnostics,
            before
        };
    }
    return {
        ok: true,
        containerPath,
        before,
        after,
        diagnostics: [...allDiagnostics, ...outcome.result.diagnostics],
        ...(outcome.result.opId ? { opId: outcome.result.opId } : {})
    };
}
async function resolveFmgTable(edit, table, containerPath, lang) {
    const wanted = table.trim();
    if (!wanted) {
        return { ok: false, error: { code: 'FMG_TABLE_REQUIRED', message: '需要表名。' }, diagnostics: [] };
    }
    let cleanContainer = containerPath?.trim();
    if (cleanContainer?.startsWith('file:///')) {
        try {
            cleanContainer = fileURLToPath(cleanContainer);
        }
        catch {
            cleanContainer = cleanContainer.slice(8);
        }
    }
    else if (cleanContainer?.startsWith('file://')) {
        cleanContainer = cleanContainer.slice(7);
    }
    const containers = cleanContainer
        ? [isAbsolute(cleanContainer) ? resolve(cleanContainer) : resolve(edit.session.layers.overlayRoot, cleanContainer)]
        : await findMsgbnds(edit.session.layers.overlayRoot, lang ?? 'zhocn');
    if (containers.length === 0) {
        // Naming a fixed language hid every other one: a workspace that only ships engus was told to
        // "confirm msg/zhocn exists". List what is actually there instead of guessing a language.
        const discovered = await findMsgbnds(edit.session.layers.overlayRoot, '');
        const languages = [...new Set(discovered
                .map((path) => /\/msg\/([^/]+)\//i.exec(path.replace(/\\/g, '/'))?.[1]?.toLowerCase())
                .filter((value) => typeof value === 'string'))].sort();
        return {
            ok: false,
            error: {
                code: 'FMG_CONTAINER_NOT_FOUND',
                message: discovered.length === 0
                    ? '工作区里没有任何 .msgbnd.dcx；请确认 msg 目录存在，或用 containerPath 指定文件。'
                    : `没有 ${lang ?? 'zhocn'} 语言的 .msgbnd.dcx；工作区里有：${languages.join('、') || '（未识别的语言目录）'}。请用 containerPath 指定其中一个。`
            },
            diagnostics: []
        };
    }
    const hits = [];
    const available = [];
    const diagnostics = [];
    const needles = tableNeedles(wanted);
    for (const path of containers) {
        const catalog = await readCatalog(edit, path);
        diagnostics.push(...catalog.diagnostics);
        if (!catalog.ok)
            continue;
        for (const item of catalog.tables)
            available.push(item.name);
        const exact = catalog.tables.filter((item) => needles.includes(item.name.toLowerCase()));
        const prefixed = exact.length > 0
            ? exact
            : catalog.tables.filter((item) => {
                const name = item.name.toLowerCase();
                return needles.some((needle) => name === needle || name.startsWith(needle) || name.includes(needle));
            });
        if (prefixed.length !== 1)
            continue;
        const match = prefixed[0];
        hits.push({
            containerPath: path,
            table: match.name,
            entryIndex: match.entryIndex,
            outerHash: catalog.outerHash
        });
    }
    if (hits.length === 0) {
        return {
            ok: false,
            error: {
                code: 'FMG_TABLE_NOT_FOUND',
                message: `没有已确认的文本表 ${wanted}。可用：${[...new Set(available)].slice(0, 24).join(', ')}`,
                details: { available: [...new Set(available)] }
            },
            diagnostics
        };
    }
    if (hits.length > 1 && !containerPath) {
        return {
            ok: false,
            error: {
                code: 'FMG_TABLE_AMBIGUOUS',
                message: `表 ${wanted} 出现在多份容器里，请指定 --container：${hits.map((hit) => hit.containerPath).join(' | ')}`
            },
            diagnostics
        };
    }
    return { ok: true, ...hits[0] };
}
async function loadTableEntries(edit, resolved) {
    const catalog = await readCatalog(edit, resolved.containerPath, resolved.entryIndex);
    if (!catalog.ok) {
        return {
            ok: false,
            error: { code: 'FMG_READ_FAILED', message: `无法读取表 ${resolved.table}。` },
            diagnostics: catalog.diagnostics
        };
    }
    return { ok: true, byId: catalog.entries, diagnostics: catalog.diagnostics };
}
async function readCatalog(edit, containerPath, tableEntryIndex) {
    const result = await runBridge({
        command: 'read-text-catalog',
        filePath: containerPath,
        resourceUri: pathToFileURL(containerPath).href,
        allowedRoots: edit.allowedRoots(),
        ...(edit.oodleRuntimeRoot ? { oodleRuntimeRoot: edit.oodleRuntimeRoot } : {}),
        timeoutMs: 60_000,
        ...(tableEntryIndex !== undefined ? { commandOptions: { tableEntryIndex } } : {})
    });
    const diagnostics = asDiagnostics(result.diagnostics);
    if (result.parseStatus === 'failed' || !result.data) {
        return { ok: false, outerHash: '', tables: [], entries: new Map(), diagnostics };
    }
    const seen = new Set();
    const tables = (result.data.tables ?? []).map((table) => ({
        name: logicalFmgTableName(table.entryName ?? `table_${table.entryIndex ?? 0}`, table.entryIndex ?? 0, seen),
        entryIndex: table.entryIndex ?? 0,
        entryCount: table.entryCount ?? 0
    }));
    const entries = new Map();
    for (const entry of result.data.entries ?? []) {
        if (typeof entry.id === 'number') {
            entries.set(entry.id, typeof entry.text === 'string' ? entry.text : null);
        }
    }
    return {
        ok: true,
        outerHash: result.data.outerHash ?? '',
        tables,
        entries,
        diagnostics
    };
}
async function findMsgbnds(overlayRoot, lang) {
    const hits = [];
    const walk = async (dir, depth) => {
        if (depth > 6 || hits.length > 24)
            return;
        let names = [];
        try {
            names = await readdir(dir);
        }
        catch {
            return;
        }
        for (const name of names) {
            const full = join(dir, name);
            let info;
            try {
                info = await stat(full);
            }
            catch {
                continue;
            }
            if (info.isDirectory()) {
                await walk(full, depth + 1);
                continue;
            }
            if (!name.toLowerCase().endsWith('.msgbnd.dcx'))
                continue;
            const normalized = full.replace(/\\/g, '/').toLowerCase();
            if (lang && !normalized.includes(`/${lang.toLowerCase()}/`))
                continue;
            hits.push(full);
        }
    };
    await walk(join(overlayRoot, 'msg'), 0);
    if (hits.length === 0 && lang)
        await walk(overlayRoot, 0);
    return hits;
}
function asDiagnostics(items) {
    return items.map((item) => ({
        severity: item.severity === 'warning' || item.severity === 'info' ? item.severity : 'error',
        code: item.code,
        message: item.message
    }));
}
async function sha256Of(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}
//# sourceMappingURL=fmgEdit.js.map