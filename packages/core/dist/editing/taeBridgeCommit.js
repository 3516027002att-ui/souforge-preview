/**
 * TAE Bridge stage helpers（ANIMATION-56C）— writers only touch staging; callers commit via Patch Engine.
 *
 * 与 esdBridgeCommit / materialBridgeCommit 同一范式：调用方给出 typed event
 * upsert mutation（tae-event-upsert），main 侧经 Patch Engine 的 outer stage 落到
 * 暂存区，由 write-tae-document 重读验证后才进入 Patch。
 *
 * 三条 mutation kind：
 *   · update-event-times —— 字节级外科替换某动画某个事件的 startTime/endTime
 *     float32。动画按 animId 定位（读信封的 stable id），事件按事件表下标
 *     eventIndex 定位。时间槽被兄弟事件共享时 C# 侧 fail-closed（sibling
 *     verify：共享槽改写会非预期地改动兄弟事件）。
 *   · insert-event —— 追加一个新事件到动画事件表末尾。事件参数体按原生
 *     eventTypeId/变体逐字节拷贝自模板
 *     事件（templateEventIndex 定位）；布局不连续时 C# 侧以
 *     TAE_WRITE_BLOCKED_UNKNOWN_STRUCTURE fail-closed，不落盘。
 *   · set-event-field —— 按 first-party schema 的 fieldIndex/fieldName 写入
 *     一个有类型字段，保留事件参数尾部。
 *
 * 注意：TAE 在 Sekiro 中通常位于 anibnd.dcx 容器内子项。本层先把 child
 * 写入 staging，再经 native BND4/DCX writer 重建外层；Patch Engine 仍是
 * 唯一提交 Mod 资源的入口。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BRIDGE_STAGING_WRITE_VERIFIED_CODES } from '@soulforge/shared';
import { runBridge } from '../bridge/runBridge.js';
export async function commitTaeEventViaBridge(request) {
    const result = await runBridge({
        command: 'write-tae-document',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        timeoutMs: request.timeoutMs ?? 60_000,
        commandOptions: {
            outputPath: request.outputPath,
            expectedDocumentHash: request.expectedDocumentHash,
            mutations: request.mutations
        }
    });
    const ok = result.diagnostics.some((d) => d.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.tae);
    return {
        ok,
        ...(result.data?.outputHash ? { outputHash: result.data.outputHash } : {}),
        ...(result.data?.outputSize !== undefined ? { outputSize: result.data.outputSize } : {}),
        ...(result.data?.mutationCount !== undefined ? { mutationCount: result.data.mutationCount } : {}),
        diagnostics: result.diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message, ...(d.details === undefined ? {} : { details: d.details })
        }))
    };
}
/**
 * Rebuild one TAE child inside an ANIBND/DCX container without making the
 * container parser a second TAE writer. The child is extracted into the
 * caller-owned staging directory, rewritten by the first-party TAE Bridge,
 * then replaced through the native BND4/DCX writer. No Mod file is touched
 * before the outer Patch Engine commit.
 */
export async function commitTaeEventContainerViaBridge(request) {
    const diagnostics = [];
    const stageDirectory = dirname(request.outputPath);
    const selectedEntryIndexes = new Set();
    if (request.taeEntryIndex !== undefined)
        selectedEntryIndexes.add(request.taeEntryIndex);
    for (const mutation of request.mutations) {
        if (mutation.taeEntryIndex !== undefined)
            selectedEntryIndexes.add(mutation.taeEntryIndex);
    }
    if (selectedEntryIndexes.size === 0
        || request.mutations.some((mutation) => (mutation.taeEntryIndex === undefined && request.taeEntryIndex === undefined))) {
        return {
            ok: false,
            diagnostics: [{
                    severity: 'error',
                    code: 'TAE_CONTAINER_ENTRY_REQUIRED',
                    message: 'ANIBND TAE 写回必须为每条 mutation 提供 taeEntryIndex。'
                }]
        };
    }
    if (request.taeEntryIndex !== undefined
        && request.mutations.some((mutation) => (mutation.taeEntryIndex !== undefined && mutation.taeEntryIndex !== request.taeEntryIndex))) {
        return {
            ok: false,
            diagnostics: [{
                    severity: 'error',
                    code: 'TAE_CONTAINER_ENTRY_SELECTOR_CONFLICT',
                    message: 'ANIBND TAE 顶层 taeEntryIndex 与 mutation selector 不一致。'
                }]
        };
    }
    const mutationsByEntry = new Map();
    for (const mutation of request.mutations) {
        const entryIndex = mutation.taeEntryIndex ?? request.taeEntryIndex;
        if (entryIndex === undefined) {
            return { ok: false, diagnostics };
        }
        const group = mutationsByEntry.get(entryIndex) ?? [];
        group.push({ ...mutation, taeEntryIndex: entryIndex });
        mutationsByEntry.set(entryIndex, group);
    }
    const replacements = [];
    for (const [entryIndex, mutations] of mutationsByEntry) {
        const childPath = join(stageDirectory, `.soulforge-${entryIndex}-${basename(request.sourcePath)}.child.tae`);
        const rewrittenPath = join(stageDirectory, `.soulforge-${entryIndex}-${basename(request.sourcePath)}.child.mut.tae`);
        const extracted = await runBridge({
            command: 'extract-bnd4-child',
            filePath: request.sourcePath,
            allowedRoots: request.allowedRoots,
            writableRoots: request.writableRoots,
            ...(request.oodleRuntimeRoot ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
            timeoutMs: request.timeoutMs ?? 120_000,
            commandOptions: {
                outputPath: childPath,
                entryIndex
            }
        });
        diagnostics.push(...toTaeCommitDiagnostics(extracted.diagnostics));
        if (extracted.parseStatus === 'failed' || !extracted.data) {
            return { ok: false, diagnostics };
        }
        const childBytes = await readFile(childPath);
        const childHash = createHash('sha256').update(childBytes).digest('hex');
        const childWrite = await commitTaeEventViaBridge({
            ...request,
            sourcePath: childPath,
            outputPath: rewrittenPath,
            expectedDocumentHash: childHash,
            allowedRoots: [...new Set([...request.allowedRoots, stageDirectory])],
            mutations
        });
        diagnostics.push(...childWrite.diagnostics);
        if (!childWrite.ok)
            return { ok: false, diagnostics };
        const rewrittenBytes = await readFile(rewrittenPath);
        replacements.push({
            mutation: 'replace',
            entryIndex,
            expectedChildHash: childHash,
            contentBase64: rewrittenBytes.toString('base64')
        });
    }
    const outerWrite = await runBridge({
        command: 'write-bnd4',
        filePath: request.sourcePath,
        allowedRoots: request.allowedRoots,
        writableRoots: request.writableRoots,
        ...(request.oodleRuntimeRoot ? { oodleRuntimeRoot: request.oodleRuntimeRoot } : {}),
        timeoutMs: request.timeoutMs ?? 120_000,
        commandOptions: {
            outputPath: request.outputPath,
            expectedContainerHash: request.expectedDocumentHash,
            mutations: replacements
        }
    });
    diagnostics.push(...toTaeCommitDiagnostics(outerWrite.diagnostics));
    const ok = outerWrite.diagnostics.some((diagnostic) => diagnostic.code === BRIDGE_STAGING_WRITE_VERIFIED_CODES.bnd4);
    return {
        ok,
        ...(typeof outerWrite.data?.outputHash === 'string' ? { outputHash: outerWrite.data.outputHash } : {}),
        ...(typeof outerWrite.data?.outputSize === 'number' ? { outputSize: outerWrite.data.outputSize } : {}),
        ...(typeof outerWrite.data?.mutationCount === 'number' ? { mutationCount: outerWrite.data.mutationCount } : {}),
        diagnostics
    };
}
function toTaeCommitDiagnostics(items) {
    return items.map((item) => ({ ...item }));
}
//# sourceMappingURL=taeBridgeCommit.js.map