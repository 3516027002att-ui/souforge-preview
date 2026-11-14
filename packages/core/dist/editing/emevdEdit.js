/**
 * Agent / CLI EMEVD facade.
 *
 * Compile DSL (patch or DarkScript) through the existing four-view submit
 * path. Does not parse native EMEVD or call write-emevd directly.
 */
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { access, stat } from 'node:fs/promises';
import { fingerprintEmedfRegistry } from '../emevd/dslCompiler.js';
import { decodeInstructionArgs, findInstructionDef } from '../emevd/emedfSchema.js';
import { renderEmevdDarkScript } from '../emevd/darkScriptRenderer.js';
import { EMEVD_EXTERNAL_SCHEMA_FORBIDDEN_CODE, resolveEmevdRegistry } from '../emevd/emedfRegistryResolver.js';
import { readFullEmevdDocumentViaBridge, sanitizeResourceUri } from './emevdFullDocument.js';
import { submitEmevdDslPlanViaFourView } from './emevdFourViewController.js';
import { decodeStrictBase64, StrictBase64Error } from '../util/base64.js';
/**
 * Preserve the Patch Engine receipt across the facade boundary. In
 * particular, a post-commit native re-read failure is not the same as a
 * transaction that never changed the file: both retain opId, but only the
 * former has transactionStatus=committed and a committedPath.
 */
export function projectEmevdSubmitResult(filePath, registryDiagnostics, result) {
    const commit = result.commit;
    const diagnostics = mergeEmevdDiagnostics([...registryDiagnostics], result.diagnostics, commit?.diagnostics ?? []);
    const noOp = result.ok
        && commit?.mutationCount === 0
        && commit.diagnostics.some((item) => item.code === 'EMEVD_PLAN_EMPTY');
    const receipt = commitReceiptFields(commit);
    if (result.ok) {
        return {
            ok: true,
            filePath,
            mutationCount: commit?.mutationCount ?? 0,
            ...(noOp ? { transactionStatus: 'noop' } : {}),
            ...(!noOp && commit?.transactionStatus ? { transactionStatus: commit.transactionStatus } : {}),
            ...receipt,
            diagnostics
        };
    }
    const first = diagnostics.find((item) => item.severity === 'error') ?? diagnostics[0];
    return {
        ok: false,
        filePath,
        ...(commit?.mutationCount === undefined ? {} : { mutationCount: commit.mutationCount }),
        ...(commit?.transactionStatus ? { transactionStatus: commit.transactionStatus } : {}),
        ...receipt,
        error: {
            code: first?.code ?? 'EMEVD_DSL_REJECTED',
            message: first?.message ?? 'DSL 编译或提交失败。'
        },
        diagnostics
    };
}
function commitReceiptFields(commit) {
    if (!commit)
        return {};
    return {
        ...(commit.opId ? { opId: commit.opId } : {}),
        ...(commit.outputHash ? { outputHash: commit.outputHash } : {}),
        ...(commit.payloadHash ? { payloadHash: commit.payloadHash } : {}),
        ...(commit.outerFileHash ? { outerFileHash: commit.outerFileHash } : {}),
        ...(commit.committedPath ? { committedPath: commit.committedPath } : {}),
        ...(commit.reRead ? { reRead: commit.reRead } : {}),
        ...(commit.nativeVerification ? { nativeVerification: commit.nativeVerification } : {})
    };
}
function mergeEmevdDiagnostics(...groups) {
    const seen = new Set();
    const merged = [];
    for (const item of groups.flat()) {
        const key = `${item.severity}\u0000${item.code}\u0000${item.message}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(...asDiagnostics([item]));
    }
    return merged;
}
/**
 * Keep one event read bounded; callers page with instructionOffset.
 *
 * The bound also decides which events can ever be written back: an event-scope DSL write needs the
 * whole event in one read (darkScriptComplete), so a cap below an event's instruction count made that
 * event permanently read-only. The Gyoubu arena lightning event (258 instructions) sat just past the
 * old 256 cap for exactly that reason. 4096 still bounds a response (~100 KB worst case) while
 * covering real events; the DSL write path keeps its own 256 KiB source budget.
 */
const MAX_EVENT_INSTRUCTION_WINDOW = 4096;
/**
 * Only precise instruction names and bounded numeric identifiers may trigger
 * a native cross-file scan. Chinese behavior phrases remain discovery/RAG
 * queries and must not cause an unbounded native read of the workspace.
 */
export function isPreciseEmevdInstructionQuery(query) {
    const value = query.trim();
    return /^(?:[A-Za-z][A-Za-z0-9_.:]*)$/.test(value) || /^\d{1,15}$/.test(value);
}
/**
 * Scan each indexed EMEVD file once, reusing its assembled full document for
 * all events. The full document stays inside this core facade; the Agent only
 * receives matching instruction DTOs plus native identity and diagnostics.
 */
export async function searchEmevdInstructionMatches(input) {
    const query = input.query.trim();
    if (!isPreciseEmevdInstructionQuery(query)) {
        return {
            ok: false,
            query,
            error: {
                code: 'EMEVD_NATIVE_SEARCH_QUERY_NOT_PRECISE',
                message: '跨文件 native EMEVD 搜索只接受精确英文指令名或安全数字 ID。'
            },
            diagnostics: []
        };
    }
    const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const registry = loadProductionRegistry(input.edit);
    if (!registry.ok) {
        return { ok: false, query, error: registry.error, diagnostics: registry.diagnostics };
    }
    const files = [...new Map(input.files
            .filter((file) => file.resourceKind === 'event' && /\.emevd(?:\.dcx)?$/i.test(file.absolutePath))
            .map((file) => [file.sourceUri, file])).values()];
    const needle = normalizeInstructionSearchText(query);
    const matches = [];
    const diagnostics = [];
    let scannedFiles = 0;
    let scannedEvents = 0;
    let complete = true;
    let truncated = false;
    let matchedCount = 0;
    for (const file of files) {
        if (input.signal?.aborted) {
            complete = false;
            diagnostics.push({
                severity: 'warning',
                code: 'EMEVD_NATIVE_SEARCH_CANCELLED',
                message: '跨文件 EMEVD native 搜索已取消。',
                sourceUri: file.sourceUri
            });
            break;
        }
        try {
            const full = await readFullEmevdDocumentViaBridge({
                filePath: file.absolutePath,
                allowedRoots: input.edit.allowedRoots(),
                resourceUri: sanitizeResourceUri(pathToFileURL(file.absolutePath).href, input.edit.session.layers.overlayRoot),
                registry: registry.registry,
                timeoutMs: 120_000,
                attachIdentity: true,
                cachePolicy: 'bypass',
                ...(input.signal ? { signal: input.signal } : {}),
                ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
            });
            scannedFiles += 1;
            diagnostics.push(...asDiagnostics(full.diagnostics));
            if (!full.ok || !full.document) {
                complete = false;
                continue;
            }
            for (const event of full.document.events) {
                scannedEvents += 1;
                for (let index = 0; index < event.instructions.length; index += 1) {
                    const instruction = readEventInstruction(event.instructions[index], index, registry.registry, event.parameters);
                    if (!instructionSearchMatches(instruction, needle))
                        continue;
                    if (matchedCount < offset) {
                        matchedCount += 1;
                        continue;
                    }
                    if (matches.length >= limit) {
                        truncated = true;
                        complete = false;
                        break;
                    }
                    matches.push({
                        sourceUri: file.sourceUri,
                        eventId: event.eventId,
                        instructionIndex: index,
                        instruction,
                        ...(full.sourceHash ? { sourceHash: full.sourceHash } : {}),
                        ...(full.outerFileHash ? { outerFileHash: full.outerFileHash } : {}),
                        authority: full.authority === 'native-verified' ? 'native-verified-event' : 'native-read-event'
                    });
                    matchedCount += 1;
                }
                if (truncated)
                    break;
            }
            if (truncated)
                break;
        }
        catch (error) {
            complete = false;
            diagnostics.push({
                severity: 'error',
                code: 'EMEVD_NATIVE_SEARCH_FILE_FAILED',
                message: error instanceof Error ? error.message : String(error),
                sourceUri: file.sourceUri
            });
        }
    }
    return {
        ok: true,
        query,
        matches,
        offset,
        limit,
        returned: matches.length,
        scannedFiles,
        scannedEvents,
        complete,
        truncated,
        diagnostics
    };
}
/**
 * Read one event through the native full-document path and return only an
 * event-level Agent DTO. The full editor document never crosses this facade.
 */
export async function readEmevdEvent(input) {
    const format = input.format ?? 'darkscript';
    if (format !== 'darkscript' && format !== 'json') {
        return {
            ok: false,
            eventId: input.eventId,
            error: { code: 'EMEVD_EVENT_FORMAT_INVALID', message: `不支持的事件读取格式：${String(format)}。` },
            diagnostics: []
        };
    }
    if (input.instructionOffset !== undefined
        && (!Number.isSafeInteger(input.instructionOffset) || input.instructionOffset < 0)) {
        return {
            ok: false,
            eventId: input.eventId,
            error: { code: 'EMEVD_INSTRUCTION_OFFSET_INVALID', message: 'instructionOffset 必须是非负安全整数。' },
            diagnostics: []
        };
    }
    if (input.instructionLimit !== undefined
        && (!Number.isSafeInteger(input.instructionLimit) || input.instructionLimit < 0)) {
        return {
            ok: false,
            eventId: input.eventId,
            error: { code: 'EMEVD_INSTRUCTION_LIMIT_INVALID', message: 'instructionLimit 必须是非负安全整数。' },
            diagnostics: []
        };
    }
    if (input.instructionLimit !== undefined && input.instructionLimit > MAX_EVENT_INSTRUCTION_WINDOW) {
        return {
            ok: false,
            eventId: input.eventId,
            error: {
                code: 'EMEVD_INSTRUCTION_LIMIT_TOO_LARGE',
                message: `单次事件读取最多返回 ${MAX_EVENT_INSTRUCTION_WINDOW} 条指令，请使用 instructionOffset 分页。`
            },
            diagnostics: []
        };
    }
    if (!Number.isSafeInteger(input.eventId)) {
        return {
            ok: false,
            eventId: input.eventId,
            error: { code: 'EMEVD_EVENT_ID_INVALID', message: 'eventId 必须是安全整数。' },
            diagnostics: []
        };
    }
    const resolved = await resolveEmevdFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, eventId: input.eventId, error: resolved.error, diagnostics: [] };
    const registry = loadProductionRegistry(input.edit);
    if (!registry.ok) {
        return {
            ok: false,
            filePath: resolved.path,
            eventId: input.eventId,
            error: registry.error,
            diagnostics: registry.diagnostics
        };
    }
    // Full-document assembly deliberately sanitizes absolute file URIs. Use the
    // exact same resource identity for compile/plan matching; sourcePath remains
    // the physical target used by the Patch Engine.
    const sourceUri = sanitizeResourceUri(pathToFileURL(resolved.path).href, input.edit.session.layers.overlayRoot);
    const full = await readFullEmevdDocumentViaBridge({
        filePath: resolved.path,
        allowedRoots: input.edit.allowedRoots(),
        resourceUri: sourceUri,
        registry: registry.registry,
        timeoutMs: 120_000,
        attachIdentity: true,
        cachePolicy: 'bypass',
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
    });
    if (!full.ok || !full.document) {
        return {
            ok: false,
            filePath: resolved.path,
            eventId: input.eventId,
            error: { code: 'EMEVD_READ_FAILED', message: '无法读取 EMEVD，拒绝返回事件 DTO。' },
            diagnostics: [...registry.diagnostics, ...asDiagnostics(full.diagnostics)]
        };
    }
    const event = full.document.events.find((candidate) => candidate.eventId === input.eventId);
    if (!event) {
        return {
            ok: false,
            sourceUri: full.document.resourceUri,
            filePath: resolved.path,
            eventId: input.eventId,
            // Say how many events exist and which ids are nearby: "not found" alone leaves the caller
            // unable to tell a typo from an event that simply is not in this file.
            error: { code: 'EMEVD_EVENT_NOT_FOUND', message: `EMEVD 中不存在事件 ${input.eventId}；该文件共 ${full.document.events.length} 个事件，最接近的 id：${full.document.events.map((candidate) => candidate.eventId).sort((left, right) => Math.abs(left - input.eventId) - Math.abs(right - input.eventId)).slice(0, 3).sort((left, right) => left - right).join('、')}。` },
            diagnostics: [...registry.diagnostics, ...asDiagnostics(full.diagnostics)]
        };
    }
    const total = event.instructions.length;
    const requestedOffset = input.instructionOffset ?? 0;
    const offset = Math.min(requestedOffset, total);
    const limit = Math.min(input.instructionLimit ?? MAX_EVENT_INSTRUCTION_WINDOW, MAX_EVENT_INSTRUCTION_WINDOW);
    const end = Math.min(total, offset + limit);
    const instructions = event.instructions.slice(offset, end).map((instruction, index) => readEventInstruction(instruction, offset + index, registry.registry, event.parameters));
    const truncated = end < total;
    // A DarkScript write receipt is complete only for the entire event: it must
    // begin at instruction zero and end exactly at the native instruction total.
    // A tail page (or an offset beyond EOF) is still a valid read, but it is not
    // safe to feed back into event-scope DSL compilation.
    const darkScriptComplete = requestedOffset === 0 && offset === 0 && end === total;
    const fileRevision = await stat(resolved.path).then((value) => value.mtimeMs).catch(() => undefined);
    const contentRevision = contentRevisionFromHash(full.outerFileHash ?? full.sourceHash);
    const fingerprint = fingerprintEmedfRegistry(registry.registry);
    const eventForRead = { ...event, instructions: event.instructions.slice(offset, end) };
    // Compute basic blocks and condition group boundaries across the whole event
    const blocks = [];
    let blockStart = 0;
    for (let i = 0; i < total; i++) {
        const instr = event.instructions[i];
        const isTerminal = (instr.bank === 2003 && (instr.id === 1 || instr.id === 2))
            || (instr.bank === 1000 && instr.id === 0)
            || (instr.bank === 1003)
            || (i === total - 1);
        if (isTerminal) {
            blocks.push({
                index: blocks.length,
                start: blockStart,
                end: i + 1
            });
            blockStart = i + 1;
        }
    }
    if (blockStart < total) {
        blocks.push({ index: blocks.length, start: blockStart, end: total });
    }
    const crossesBlockBoundary = blocks.some((b) => (offset > b.start && offset < b.end) || (end > b.start && end < b.end));
    const dto = {
        ok: true,
        sourceUri: full.document.resourceUri,
        sourcePath: resolved.path,
        filePath: resolved.path,
        eventId: event.eventId,
        restBehavior: event.restBehavior,
        instructionCount: total,
        total,
        offset,
        limit,
        returned: instructions.length,
        truncated,
        darkScriptComplete,
        readRange: { start: offset, end },
        crossesBlockBoundary,
        blocks,
        ...(full.sourceHash ? { sourceHash: full.sourceHash } : {}),
        ...(full.outerFileHash ? { outerFileHash: full.outerFileHash } : {}),
        ...(contentRevision !== undefined
            ? { sourceRevision: contentRevision, sourceRevisionKind: 'content-hash' }
            : (fileRevision !== undefined ? { sourceRevision: fileRevision, sourceRevisionKind: 'mtime' } : {})),
        game: input.edit.session.meta.game,
        resourceKind: 'event',
        registryOrigin: registry.registry.origin,
        registryFingerprint: fingerprint,
        registry: {
            origin: registry.registry.origin,
            fingerprint,
            ...(registry.registry.packageId ? { packageId: registry.registry.packageId } : {}),
            ...(registry.registry.packageVersion ? { packageVersion: registry.registry.packageVersion } : {}),
            ...(registry.registry.contentDigest ? { contentDigest: registry.registry.contentDigest } : {})
        },
        ...(registry.registry.packageId ? { registryPackageId: registry.registry.packageId } : {}),
        ...(registry.registry.packageVersion ? { registryPackageVersion: registry.registry.packageVersion } : {}),
        ...(registry.registry.contentDigest ? { registryContentDigest: registry.registry.contentDigest } : {}),
        format,
        ...(format === 'darkscript'
            ? { darkScript: renderEmevdDarkScript({ ...full.document, events: [eventForRead] }, registry.registry) }
            : {}),
        instructions,
        diagnostics: [
            ...registry.diagnostics,
            ...asDiagnostics(full.diagnostics),
            ...(truncated ? [{
                    severity: 'warning',
                    code: 'EMEVD_EVENT_INSTRUCTIONS_PAGED',
                    message: `仅返回指令 ${offset}..${Math.max(offset, end - 1)}；DarkScript 不完整，不能直接作为写回源码。`
                }] : [])
        ]
    };
    return dto;
}
export async function readEmevdOutline(input) {
    const resolved = await resolveEmevdFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const registry = loadProductionRegistry(input.edit);
    if (!registry.ok) {
        return { ok: false, error: registry.error, diagnostics: registry.diagnostics };
    }
    const full = await readFullEmevdDocumentViaBridge({
        filePath: resolved.path,
        allowedRoots: input.edit.allowedRoots(),
        resourceUri: pathToFileURL(resolved.path).href,
        registry: registry.registry,
        timeoutMs: 120_000,
        attachIdentity: true,
        cachePolicy: 'bypass',
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
    });
    if (!full.ok || !full.document) {
        return {
            ok: false,
            error: { code: 'EMEVD_READ_FAILED', message: '无法读取 EMEVD。' },
            diagnostics: [...registry.diagnostics, ...asDiagnostics(full.diagnostics)]
        };
    }
    const outlineRevision = contentRevisionFromHash(full.outerFileHash ?? full.sourceHash);
    return {
        ok: true,
        filePath: resolved.path,
        ...(full.sourceHash ? { sourceHash: full.sourceHash } : {}),
        ...(full.outerFileHash ? { outerFileHash: full.outerFileHash } : {}),
        ...(outlineRevision !== undefined ? { sourceRevision: outlineRevision } : {}),
        events: full.document.events.map((event) => ({
            eventId: event.eventId,
            restBehavior: event.restBehavior,
            instructionCount: event.instructions.length
        })),
        diagnostics: [...registry.diagnostics, ...asDiagnostics(full.diagnostics)]
    };
}
export async function applyEmevdDsl(input) {
    if (hasLegacyExternalSchemaOption(input)) {
        const message = '生产 EMEVD 链不接受外部 EMEDF schema；请使用 SoulForge 内置 schema。';
        return {
            ok: false,
            error: { code: EMEVD_EXTERNAL_SCHEMA_FORBIDDEN_CODE, message },
            diagnostics: [{ severity: 'error', code: EMEVD_EXTERNAL_SCHEMA_FORBIDDEN_CODE, message }]
        };
    }
    if (input.dsl.trim().length === 0) {
        return { ok: false, error: { code: 'EMEVD_DSL_EMPTY', message: 'DSL 为空。' }, diagnostics: [] };
    }
    const resolved = await resolveEmevdFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const scopeIds = [input.scopeEventId, input.eventId, input.scope?.eventId]
        .filter((value) => value !== undefined);
    const distinctScopeIds = [...new Set(scopeIds)];
    if (distinctScopeIds.length > 1) {
        return {
            ok: false,
            filePath: resolved.path,
            error: { code: 'EMEVD_DSL_SCOPE_CONFLICT', message: 'eventId、scopeEventId 与 scope.eventId 不一致。' },
            diagnostics: []
        };
    }
    const scopeEventId = distinctScopeIds[0];
    if (scopeEventId !== undefined && !Number.isSafeInteger(scopeEventId)) {
        return {
            ok: false,
            filePath: resolved.path,
            error: { code: 'EMEVD_DSL_SCOPE_EVENT_ID_INVALID', message: '事件作用域 eventId 必须是安全整数。' },
            diagnostics: []
        };
    }
    const mode = input.mode ?? 'patch';
    const createIfMissing = input.createIfMissing === true;
    if (createIfMissing && scopeEventId === undefined) {
        return {
            ok: false,
            filePath: resolved.path,
            error: {
                code: 'EMEVD_DSL_CREATE_REQUIRES_EVENT_SCOPE',
                message: 'createIfMissing 只能与 scope=event + eventId 一起使用：新建必须点名目标事件 id。'
            },
            diagnostics: []
        };
    }
    if (createIfMissing && mode !== 'dark-script' && !looksLikeDarkScriptSource(input.dsl)) {
        return {
            ok: false,
            filePath: resolved.path,
            error: {
                code: 'EMEVD_DSL_CREATE_REQUIRES_DARKSCRIPT',
                message: '新建事件只接受 DarkScript 单事件源码（$Event(eventId, Restart, function() { ... })）。'
            },
            diagnostics: []
        };
    }
    if (scopeEventId !== undefined && mode === 'patch' && !looksLikeDarkScriptSource(input.dsl)) {
        return {
            ok: false,
            filePath: resolved.path,
            error: { code: 'EMEVD_DSL_SCOPE_REQUIRES_DARKSCRIPT', message: '事件作用域只允许 DarkScript 单事件源码。' },
            diagnostics: []
        };
    }
    if (scopeEventId !== undefined && input.darkScriptComplete === false) {
        return {
            ok: false,
            filePath: resolved.path,
            error: {
                code: 'EMEVD_DSL_INCOMPLETE_SOURCE',
                message: '事件作用域拒绝使用分页 DarkScript；请先读取完整事件后再写回。'
            },
            diagnostics: []
        };
    }
    const registry = loadProductionRegistry(input.edit, input);
    if (!registry.ok)
        return { ok: false, error: registry.error, diagnostics: registry.diagnostics };
    // Full-document assembly deliberately sanitizes absolute file URIs. Use the
    // exact same resource identity for compile/plan matching; sourcePath remains
    // the physical target used by the Patch Engine.
    const sourceUri = sanitizeResourceUri(pathToFileURL(resolved.path).href, input.edit.session.layers.overlayRoot);
    const full = await readFullEmevdDocumentViaBridge({
        filePath: resolved.path,
        allowedRoots: input.edit.allowedRoots(),
        resourceUri: sourceUri,
        registry: registry.registry,
        timeoutMs: 120_000,
        attachIdentity: true,
        cachePolicy: 'bypass',
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {})
    });
    if (!full.ok || !full.document) {
        return {
            ok: false,
            error: { code: 'EMEVD_READ_FAILED', message: '无法读取 EMEVD，拒绝提交 DSL。' },
            diagnostics: [...registry.diagnostics, ...asDiagnostics(full.diagnostics)]
        };
    }
    // Conflict check happens against the freshly read native document, before any
    // compile or staging: create mode is additive or refused, never a silent
    // overwrite of an event that already owns this id.
    if (createIfMissing && scopeEventId !== undefined) {
        const existing = full.document.events.find((event) => event.eventId === scopeEventId);
        if (existing) {
            const message = `事件 ${scopeEventId} 已存在（${existing.instructions.length} 条指令）：新建模式不会覆盖已有事件。`
                + '要修改它，请省略 createIfMissing 后按该事件作用域写回；要新建，请换一个未被占用的 eventId。';
            return {
                ok: false,
                filePath: resolved.path,
                error: { code: 'EMEVD_EVENT_ALREADY_EXISTS', message },
                diagnostics: [{
                        severity: 'error',
                        code: 'EMEVD_EVENT_ALREADY_EXISTS',
                        message
                    }]
            };
        }
    }
    // The revision a read hands out is content-derived when the source identity is known, so a
    // write+rollback that restores identical bytes no longer invalidates the caller's four-tuple.
    const currentRevision = contentRevisionFromHash(full.outerFileHash ?? full.sourceHash)
        ?? await stat(resolved.path).then((value) => value.mtimeMs).catch(() => undefined);
    // Name the identity that actually disagrees. The old message printed sourceHash next to a
    // sourceRevision comparison, so a stale revision reported the same hash twice and left the caller
    // with nothing to fix.
    const identityMismatch = [];
    if (input.sourceHash !== undefined && (!full.sourceHash || input.sourceHash !== full.sourceHash))
        identityMismatch.push(`sourceHash expected=${input.sourceHash} actual=${full.sourceHash ?? '未知'}`);
    if (input.outerFileHash !== undefined && (!full.outerFileHash || input.outerFileHash !== full.outerFileHash))
        identityMismatch.push(`outerFileHash expected=${input.outerFileHash} actual=${full.outerFileHash ?? '未知'}`);
    if (input.sourceRevision !== undefined && (currentRevision === undefined || input.sourceRevision !== currentRevision))
        identityMismatch.push(`sourceRevision expected=${input.sourceRevision} actual=${currentRevision ?? '未知'}`);
    if (identityMismatch.length > 0) {
        const hint = '文件在读取后被改写（或回滚改动了 mtime）。请重新 read_emevd_event 取完整事件，把 sourceHash/outerFileHash/sourceRevision 原样回传，并在同一 session 内写入。';
        return {
            ok: false,
            filePath: resolved.path,
            error: {
                code: 'EMEVD_DSL_SOURCE_STALE',
                message: `EMEVD 源身份不匹配：${identityMismatch.join('；')}。${hint}`
            },
            diagnostics: [{
                    severity: 'warning',
                    code: 'EMEVD_DSL_SOURCE_STALE',
                    message: identityMismatch.join('；')
                }]
        };
    }
    const result = await submitEmevdDslPlanViaFourView({
        compileRequest: {
            schemaVersion: 1,
            resourceUri: sourceUri,
            documentInstanceId: full.document.documentInstanceId ?? '',
            baseRevision: full.document.revision,
            emedfSchemaFingerprint: fingerprintEmedfRegistry(registry.registry),
            sourceText: input.dsl,
            mode,
            ...(scopeEventId !== undefined ? { scopeEventId } : {}),
            ...(createIfMissing && scopeEventId !== undefined ? { createEventId: scopeEventId } : {})
        },
        document: full.document,
        registry: registry.registry,
        sourcePath: resolved.path,
        expectedDocumentHash: full.sourceHash ?? '',
        ...(full.outerFileHash ? { expectedOuterFileHash: full.outerFileHash } : {}),
        allowedRoots: input.edit.allowedRoots(),
        workspaceId: input.edit.session.meta.workspaceId,
        workspaceRoot: input.edit.session.layers.overlayRoot,
        stagingRoot: input.edit.stagingRoot,
        ...(input.edit.oodleRuntimeRoot !== undefined ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        targetUri: sourceUri,
        title: `EMEVD DSL ${basename(resolved.path)}`,
        session: input.edit.session,
        operationLog: input.edit.operationLog,
        backupBaseDir: input.edit.backupBaseDir,
        recoveryDir: input.edit.recoveryDir,
        timeoutMs: 120_000
    });
    const projected = projectEmevdSubmitResult(resolved.path, registry.diagnostics, result);
    if (!projected.ok) {
        const resourceMismatch = projected.diagnostics.find((diagnostic) => diagnostic.code === 'EMEVD_DSL_RESOURCE_MISMATCH');
        if (resourceMismatch) {
            projected.error = {
                code: resourceMismatch.code,
                message: `${resourceMismatch.message} request=${sourceUri} document=${full.document.resourceUri}`
            };
        }
    }
    return projected;
}
function looksLikeDarkScriptSource(source) {
    return /\$Event\s*\(/.test(source);
}
/**
 * Content-derived sourceRevision for EMEVD.
 *
 * The identity four-tuple (sourceHash, outerFileHash, sourceRevision, darkScriptComplete) used to carry
 * a file mtime, so two rounds could see the same sha256 with different revisions: any write+rollback
 * changes mtime even though the bytes (and hashes) return to the same value, and a read taken before
 * the round was then refused as stale for no content reason. Deriving the number from the content hash
 * makes identical bytes keep the identical revision in every process. The hash remains authoritative;
 * this number is only the cheap equality token. 48 bits keeps it a safe integer.
 */
export function contentRevisionFromHash(hash) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/iu.test(hash))
        return undefined;
    const value = Number.parseInt(hash.slice(0, 12), 16);
    return Number.isSafeInteger(value) ? value : undefined;
}
function readEventInstruction(instruction, index, registry, parameters) {
    const diagnostics = [];
    const definition = instruction.unknown ? undefined : findInstructionDef(registry, instruction.bank, instruction.id);
    if (instruction.unknown) {
        diagnostics.push({ severity: 'warning', code: 'EMEVD_INSTRUCTION_MARKED_UNKNOWN', message: '原生文档将该指令标记为 unknown，保持不透明。' });
        return { index, bank: instruction.bank, id: instruction.id, argsBase64: instruction.argsBase64, unknown: true, diagnostics };
    }
    if (!definition) {
        diagnostics.push({ severity: 'warning', code: 'EMEDF_UNKNOWN_INSTRUCTION', message: `EMEDF 中没有 bank=${instruction.bank} id=${instruction.id}。` });
        diagnostics.push({ severity: 'warning', code: 'EMEDF_SCHEMA_COVERAGE_GAP', message: `SoulForge 内置 EMEVD schema 未覆盖 bank=${instruction.bank} id=${instruction.id}，保留原始字节并保持只读。` });
        return { index, bank: instruction.bank, id: instruction.id, argsBase64: instruction.argsBase64, unknown: true, diagnostics };
    }
    try {
        const rawArgs = decodeStrictBase64(instruction.argsBase64, { allowEmpty: true });
        const decoded = decodeInstructionArgs(registry, instruction.bank, instruction.id, rawArgs);
        if (!decoded.ok) {
            diagnostics.push({ severity: 'warning', code: decoded.code, message: decoded.message });
            if (decoded.code === 'EMEDF_ARGS_LENGTH_MISMATCH') {
                diagnostics.push({ severity: 'warning', code: 'EMEDF_SCHEMA_COVERAGE_GAP', message: `SoulForge 内置 EMEVD schema 与 bank=${instruction.bank} id=${instruction.id} 的原生参数长度不匹配，保留原始字节并保持只读。` });
            }
            return {
                index, bank: instruction.bank, id: instruction.id, argsBase64: instruction.argsBase64,
                unknown: true, emedfName: definition.name, diagnostics
            };
        }
        return {
            index,
            bank: instruction.bank,
            id: instruction.id,
            argsBase64: instruction.argsBase64,
            unknown: false,
            emedfName: decoded.def.name,
            typedArgs: decoded.args.map((arg) => {
                const parameter = parameters?.find((item) => item.instructionIndex === index && item.targetStartByte === arg.startByte);
                return parameter ? { ...arg, parameterSymbol: `X${parameter.sourceStartByte}_${parameter.byteCount}` } : arg;
            }),
            diagnostics
        };
    }
    catch (error) {
        const code = error instanceof StrictBase64Error ? error.code : 'EMEVD_INSTRUCTION_DECODE_FAILED';
        const message = error instanceof Error ? error.message : '指令参数解码失败。';
        diagnostics.push({ severity: 'warning', code, message });
        return {
            index, bank: instruction.bank, id: instruction.id, argsBase64: instruction.argsBase64,
            unknown: true, emedfName: definition.name, diagnostics
        };
    }
}
function normalizeInstructionSearchText(value) {
    return value
        .toLocaleLowerCase()
        .replaceAll('_', ' ')
        .replaceAll(':', ' ')
        .replaceAll('.', ' ')
        .split(/\s+/)
        .filter(Boolean)
        .join(' ');
}
function instructionSearchMatches(instruction, normalizedQuery) {
    const values = [
        instruction.emedfName,
        String(instruction.bank),
        String(instruction.id),
        // A bound parameter keeps both its symbol and its numeric value: dropping the value whenever a
        // symbol exists makes the most common question ("which event awards item lot 90017000?") unanswerable.
        ...(instruction.typedArgs ?? []).flatMap((arg) => [
            arg.name,
            ...(arg.parameterSymbol ? [arg.parameterSymbol] : []),
            String(arg.value)
        ])
    ]
        .filter((value) => typeof value === 'string' && value.length > 0)
        .map(normalizeInstructionSearchText);
    const haystack = values.join(' ');
    return haystack.split(' ').includes(normalizedQuery)
        || haystack.includes(normalizedQuery);
}
async function resolveEmevdFile(edit, file) {
    const overlay = edit.session.layers.overlayRoot;
    const base = edit.session.layers.baseRoot;
    const candidates = [
        resolve(file),
        join(overlay, file),
        join(overlay, 'event', file),
        join(overlay, 'event', `${file}.emevd.dcx`)
    ];
    if (base) {
        candidates.push(join(base, file), join(base, 'event', file), join(base, 'event', `${file}.emevd.dcx`));
    }
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return { ok: true, path: candidate };
        }
        catch {
            // try next
        }
    }
    return {
        ok: false,
        error: { code: 'EMEVD_FILE_NOT_FOUND', message: `工作区内找不到事件文件：${file}（期望 event/<mapId>.emevd.dcx，mapId 形如 m11_02_00_00）` }
    };
}
function hasLegacyExternalSchemaOption(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input))
        return false;
    const record = input;
    return Object.prototype.hasOwnProperty.call(record, 'emedfPath')
        || Object.prototype.hasOwnProperty.call(record, 'emedfLocator');
}
function loadProductionRegistry(edit, legacyInput) {
    if (hasLegacyExternalSchemaOption(legacyInput)
        || hasLegacyExternalSchemaOption(edit)
        || hasLegacyExternalSchemaOption(edit.session)) {
        const message = '生产 EMEVD 链不接受外部 EMEDF schema；请使用 SoulForge 内置 schema。';
        return {
            ok: false,
            error: { code: EMEVD_EXTERNAL_SCHEMA_FORBIDDEN_CODE, message },
            diagnostics: [{ severity: 'error', code: EMEVD_EXTERNAL_SCHEMA_FORBIDDEN_CODE, message }]
        };
    }
    const resolved = resolveEmevdRegistry();
    const diagnostics = asDiagnostics(resolved.diagnostics);
    if (resolved.origin !== 'first-party') {
        const first = diagnostics[0];
        return {
            ok: false,
            error: {
                code: first?.code ?? 'EMEVD_FIRST_PARTY_SCHEMA_UNAVAILABLE',
                message: first?.message ?? 'SoulForge 内置 EMEVD schema 不可用。'
            },
            diagnostics
        };
    }
    return { ok: true, registry: resolved.registry, diagnostics };
}
function asDiagnostics(items) {
    return items.map((item) => ({
        severity: item.severity === 'warning' || item.severity === 'info' ? item.severity : 'error',
        code: item.code,
        message: item.message
    }));
}
//# sourceMappingURL=emevdEdit.js.map