import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createOpaqueCursor } from '@soulforge/shared';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDefaultOperationLogStore } from '../patch/operationLog.js';
import { RAG_CHUNK_FAMILIES } from '@soulforge/shared';
import { ALL_RESOURCE_KINDS } from '../workspace/resourceKinds.js';
import { isActiveSemanticSource } from '../workspace/resourceKinds.js';
import { nativeEditSessionFromContext } from '../editing/nativeEditSession.js';
import { readParamFields } from '../param/containerParamEdit.js';
import * as emevdEdit from '../editing/emevdEdit.js';
import { legacyPermissionToLevel } from './toolPermissions.js';
import { buildRagCorpus, mergeCatalogAndPersisted } from '../rag/chunkBuilder.js';
import { retrieveEvidence } from '../rag/retrieve.js';
import { attachLookupIndexAsync } from '../rag/lookupIndex.js';
import { getRagStaleChunkMaskCached } from '../rag/freshness.js';
import { isChunkEligible, normalizeRetrievalScope } from '../rag/retrievalScope.js';
import { setImmediate as yieldRagGrouping } from 'node:timers/promises';
import { sourceTextPage } from './sourceTextPage.js';
import { literalSourceSearchPage } from './literalSourceSearchPage.js';
import { readHksSource } from '../editing/hksRead.js';
import { createScopedEventSearchCursor } from './scopedEventSearchCursor.js';
export function resolveReadEmevdEvent() {
    const candidate = emevdEdit.readEmevdEvent;
    return typeof candidate === 'function' ? candidate : undefined;
}
/**
 * Preserve the irreversible transaction fact even when post-commit work
 * fails.  Knowledge refresh is deliberately best-effort after the Patch
 * Engine has committed; it must never turn the tool into a pre-commit
 * failure.
 */
/** Workspace-relative POSIX form of an absolute path inside the opened workspace, else undefined. */
function workspaceRelativePath(absolutePath, root) {
    if (!isAbsolute(absolutePath))
        return undefined;
    const rel = relative(root, absolutePath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
        return undefined;
    return rel.split(sep).join('/');
}
/**
 * Receipts must carry logical identifiers, not host paths. Native facades hand back absolute
 * container/file paths, so every committed result is projected once here instead of per tool.
 */
function projectWorkspacePaths(value, root, depth = 0) {
    if (root === undefined || depth > 6 || value === null || value === undefined)
        return value;
    if (typeof value === 'string') {
        if (/^file:\/\//i.test(value)) {
            let absolute;
            try {
                absolute = fileURLToPath(value);
            }
            catch {
                return value;
            }
            const rel = workspaceRelativePath(absolute, root);
            return rel === undefined ? value : `file://${rel}`;
        }
        return workspaceRelativePath(value, root) ?? value;
    }
    if (Array.isArray(value))
        return value.map((item) => projectWorkspacePaths(item, root, depth + 1));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = projectWorkspacePaths(item, root, depth + 1);
        }
        return out;
    }
    return value;
}
/**
 * Map writers return the whole post-state document and scene graph (megabytes on a real map),
 * which forces the committed projection to throw the receipt away. Keep what a caller can act on:
 * the revision and the touched entities, and say explicitly that the bulk was omitted.
 */
/**
 * Map writers return the whole post-state document and scene graph (megabytes on a real map),
 * which forces the committed projection to throw the receipt away. Keep what a caller can act on:
 * the revision and the touched entities, and say explicitly that the bulk was omitted. The post
 * state can sit at any depth (a tool may wrap the service result), so walk the object.
 */
function boundMapPostState(value, depth = 0) {
    if (depth > 4)
        return value;
    if (Array.isArray(value))
        return value.map((item) => boundMapPostState(item, depth + 1));
    if (!value || typeof value !== 'object')
        return value;
    const record = value;
    const out = {};
    for (const [key, item] of Object.entries(record)) {
        if (key === 'verifiedPostState' && item && typeof item === 'object' && !Array.isArray(item)) {
            const state = item;
            const touched = Array.isArray(state.touchedEntities) ? state.touchedEntities : [];
            if ('doc' in state || 'sceneGraph' in state) {
                out[key] = {
                    ...(typeof state.sourceVersion === 'string' ? { sourceVersion: state.sourceVersion } : {}),
                    touchedEntities: touched,
                    touchedCount: touched.length,
                    ...('doc' in state ? { docOmitted: true } : {}),
                    ...('sceneGraph' in state ? { sceneGraphOmitted: true } : {})
                };
                continue;
            }
        }
        out[key] = boundMapPostState(item, depth + 1);
    }
    return out;
}
export async function finalizeCommittedToolResult(input) {
    let nativeVerification = { status: 'not_performed' };
    if (input.verifyNative) {
        try {
            const verification = await input.verifyNative();
            nativeVerification = verification.ok
                ? { status: 'verified', ...(verification.details === undefined ? {} : { details: verification.details }) }
                : {
                    status: 'failed',
                    code: verification.code,
                    message: verification.message,
                    ...(verification.details === undefined ? {} : { details: verification.details })
                };
        }
        catch (error) {
            nativeVerification = {
                status: 'failed',
                code: 'POST_COMMIT_NATIVE_READ_EXCEPTION',
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }
    let knowledgeRefresh;
    let knowledgeRefreshStatus = input.context.onNativeWriteCommitted ? 'completed' : 'not_requested';
    if (input.context.onNativeWriteCommitted) {
        try {
            const refreshed = await input.context.onNativeWriteCommitted(input.changedSources);
            if (refreshed)
                knowledgeRefresh = refreshed;
            if (knowledgeRefresh && 'status' in knowledgeRefresh && typeof knowledgeRefresh.status === 'string') {
                knowledgeRefreshStatus = knowledgeRefresh.status;
            }
        }
        catch (error) {
            knowledgeRefreshStatus = 'failed';
            knowledgeRefresh = {
                status: 'failed',
                code: 'KNOWLEDGE_REFRESH_FAILED',
                message: error instanceof Error ? error.message : String(error),
                changedSources: [...input.changedSources]
            };
        }
    }
    const state = nativeVerification.status === 'failed' ? 'verification_failed' : 'committed';
    // T10 steps 12/15: once the outer file has been committed (or rolled back),
    // invalidate the automatic read proofs for every changed source REGARDLESS
    // of whether post-commit verification / knowledge refresh / serialization
    // succeed. A stale-version proof must never authorize a later write; the
    // caller gets a native re-read entry point, not a ledger requirement.
    const proofStore = input.context.nativeReadProofs ?? input.context.coreSession?.proofStore;
    if (proofStore) {
        const scopes = [...(input.invalidateProofScopes ?? [])];
        for (const source of input.changedSources) {
            const generation = Date.now();
            const matches = scopes.filter((scope) => scope.source === source);
            if (matches.length > 0) {
                // 只让被写到的子表/段过期；同外层的其它读证明的字节没有被改动。
                for (const scope of matches) {
                    proofStore.invalidateSourceWhere(source, generation, scope.matches);
                }
            }
            else {
                proofStore.invalidateSource(source, generation);
            }
            // Native facades report physical paths while proof identities use the
            // canonical file URL. Invalidate both spellings when no Core session
            // helper is available; a CoreToolSession performs the same fan-out.
            if (isAbsolute(source)) {
                const url = pathToFileURL(source).href;
                if (matches.length > 0) {
                    for (const scope of matches) {
                        proofStore.invalidateSourceWhere(url, generation, scope.matches);
                    }
                }
                else {
                    proofStore.invalidateSource(url, generation);
                }
                // 这次写入是本进程自己的：把外部变化监听的基线推到提交后的状态，否则轮询器
                // 会把同一个变更再当成外部改动、把没写到的子表/段的证明也一并作废。
                input.context.coreSession?.rebaselineOuterFile(source);
            }
        }
        if (input.invalidateProofKeys) {
            for (const key of input.invalidateProofKeys) {
                proofStore.invalidateSource(key, Date.now());
            }
        }
    }
    const overlayRoot = input.context.session?.layers.overlayRoot
        ?? input.context.coreSession?.workspaceSession?.layers.overlayRoot;
    const boundedData = boundMapPostState(input.data);
    const projectedData = overlayRoot === undefined
        ? boundedData
        : projectWorkspacePaths(boundedData, overlayRoot);
    return {
        ok: true,
        state,
        data: {
            ...projectedData,
            ...(knowledgeRefresh ? { knowledgeRefresh } : {}),
            lifecycle: {
                transaction: 'committed',
                nativeVerification,
                knowledgeRefresh: knowledgeRefreshStatus
            }
        }
    };
}
/**
 * Map the EMEVD facade result into the registry lifecycle contract. This is
 * kept separate from the native handler so the no-op and post-commit-failure
 * boundaries can be tested without starting a Bridge process.
 */
export async function finalizeEmevdDslApplyResult(result, file, context) {
    // A post-commit Bridge re-read can fail after the durable Patch Engine
    // transaction has already committed. Do not turn that state into an
    // ordinary failed tool call: preserve the operation receipt and let the
    // finalizer expose state=verification_failed with transaction=committed.
    if (!result.ok && result.transactionStatus !== 'committed') {
        return fail(result.error?.code ?? 'EMEVD_DSL_FAILED', result.error?.message ?? 'EMEVD DSL 提交失败。', {
            transactionStatus: result.transactionStatus ?? 'not_committed',
            ...(result.opId ? { opId: result.opId } : {}),
            ...(result.outputHash ? { outputHash: result.outputHash } : {}),
            ...(result.payloadHash ? { payloadHash: result.payloadHash } : {}),
            ...(result.outerFileHash ? { outerFileHash: result.outerFileHash } : {}),
            diagnostics: result.diagnostics
        });
    }
    // A compile-only empty plan never opened a transaction and must not claim
    // committed merely because the mutation handler uses the common finalizer.
    if (result.transactionStatus === 'noop')
        return ok(result);
    return finalizeCommittedToolResult({
        data: result,
        changedSources: [result.filePath ?? file],
        context,
        verifyNative: async () => {
            const verification = result.nativeVerification;
            if (verification?.status === 'verified') {
                return { ok: true, details: verification.details };
            }
            return {
                ok: false,
                code: verification?.code ?? 'EMEVD_POST_COMMIT_VERIFICATION_MISSING',
                message: verification?.message ?? '提交后的 EMEVD 原生重读验证未形成结构化回执。',
                ...(verification?.details === undefined ? {} : { details: verification.details })
            };
        }
    });
}
/**
 * 回执里的两种十进制写法，是不是同一个原生值。
 *
 * `read_param_fields` 交的是 Bridge 解出的值：float32 用 JSON 能承载的最短往返写法
 * （0.4）。写入回执的 before/after 由写入器在 TS 侧从「即将写入的字节」同步算出，
 * 同一批位被扩宽成 double（0.4000000059604645）。两者是同一个 float32，所以 f32 按
 * float32 位判断（`Math.fround` 不经十进制、也不留容差），非有限值按命名常量判断；
 * 其它类型仍是 `Object.is`，整数和 f64 因此不会因为取整被判等。
 */
function sameParamFieldValue(observed, expected, type) {
    if (Object.is(observed, expected))
        return true;
    const asFloat = (value) => {
        if (typeof value === 'number')
            return value;
        if (value === 'NaN')
            return Number.NaN;
        if (value === 'Infinity')
            return Number.POSITIVE_INFINITY;
        if (value === '-Infinity')
            return Number.NEGATIVE_INFINITY;
        return undefined;
    };
    if (type === 'f64') {
        const left = asFloat(observed);
        const right = asFloat(expected);
        return left !== undefined && right !== undefined && Object.is(left, right);
    }
    // `angle32` is the paramdex spelling of the same 4-byte float the Bridge decodes.
    if (type !== 'f32' && type !== 'angle32')
        return false;
    const left = asFloat(observed);
    const right = asFloat(expected);
    if (left === undefined || right === undefined)
        return false;
    return Object.is(Math.fround(left), Math.fround(right));
}
export async function verifyCommittedParamFields(input) {
    // The receipt must cover every edited cell: the reread pages cells, so a write with
    // more cells than one page has to follow the cursor. Reading only the first page
    // reported the extra cells as `observed: undefined` mismatches.
    const observedFields = [];
    // Field definitions arrive per page and carry no table, so a field id that two tables
    // spell with different types stays ambiguous and is never used to compare values.
    const observedTypes = new Map();
    let cursor;
    for (let page = 0; page < 64; page += 1) {
        const reread = await readParamFields({
            edit: input.edit,
            containerPath: input.containerPath,
            pageSize: 128,
            ...(cursor === undefined ? {} : { cursor }),
            queries: input.edits.map((edit) => ({
                table: edit.table,
                rowIds: [edit.rowId],
                fieldIds: [edit.fieldId],
                ...(edit.rowIndex === undefined ? {} : { rowIndex: edit.rowIndex })
            }))
        });
        if (!reread.ok) {
            return {
                ok: false,
                code: 'PARAM_POST_COMMIT_READ_FAILED',
                message: reread.error.message,
                details: reread.error.details
            };
        }
        observedFields.push(...reread.fields);
        for (const definition of reread.fieldDefinitions ?? []) {
            const types = observedTypes.get(definition.fieldId) ?? new Set();
            types.add(definition.type);
            observedTypes.set(definition.fieldId, types);
        }
        if (!reread.pagination?.hasMore || !reread.pagination.nextCursor)
            break;
        cursor = reread.pagination.nextCursor;
    }
    const normalizeTable = (value) => value.toLocaleLowerCase().replace(/[^a-z0-9]/gu, '');
    const unambiguousType = (fieldId) => {
        const types = observedTypes.get(fieldId);
        return types?.size === 1 ? [...types][0] : undefined;
    };
    const mismatches = [];
    const verifiedFields = [];
    for (const expected of input.expected) {
        const observed = observedFields.find((field) => (normalizeTable(field.table) === normalizeTable(expected.table)
            && field.rowId === expected.rowId
            && field.fieldId === expected.fieldId
            && (expected.rowIndex === undefined || field.rowIndex === expected.rowIndex)));
        if (!observed || !observed.sourceHash
            || !sameParamFieldValue(observed.value, expected.value, unambiguousType(expected.fieldId))) {
            mismatches.push({
                table: expected.table,
                rowId: expected.rowId,
                fieldId: expected.fieldId,
                expected: expected.value,
                observed: observed?.value ?? null,
                sourceHash: observed?.sourceHash ?? null
            });
            continue;
        }
        verifiedFields.push({
            table: observed.table,
            rowId: observed.rowId,
            fieldId: observed.fieldId,
            value: observed.value,
            sourceHash: observed.sourceHash,
            ...(observed.sourceRevision === undefined ? {} : { sourceRevision: observed.sourceRevision }),
            // The post-commit reread is a live native read, so its revision is content-derived.
            // Publish it under the cross-tool name as well: a caller that has a pre-write
            // search_param_rows/contentRevision can compare the two without knowing this rule.
            ...(observed.contentRevision === undefined
                ? {}
                : { contentRevision: observed.contentRevision, sourceRevisionKind: 'content-hash' })
        });
    }
    if (mismatches.length > 0) {
        return {
            ok: false,
            code: 'PARAM_POST_COMMIT_VERIFICATION_MISMATCH',
            message: 'PARAM 已提交，但原生复读值或 sourceHash 与预期不一致；操作保留为 committed，必须回滚或恢复。',
            details: { mismatches }
        };
    }
    return { ok: true, details: { fields: verifiedFields } };
}
export function summarizeReferences(edges) {
    return {
        high: edges.filter((edge) => edge.confidence === 'high').length,
        medium: edges.filter((edge) => edge.confidence === 'medium').length,
        low: edges.filter((edge) => edge.confidence === 'low').length,
        total: edges.length
    };
}
export function normalizePermissionLevel(permission) {
    if (permission === 'read'
        || permission === 'analyze'
        || permission === 'propose'
        || permission === 'stage'
        || permission === 'validate'
        || permission === 'commit'
        || permission === 'rollback') {
        return permission;
    }
    if (permission === 'plan' || permission === 'write') {
        return legacyPermissionToLevel(permission);
    }
    return 'read';
}
export function ok(data) {
    return { ok: true, state: 'completed', data };
}
export function fail(code, message, details) {
    return {
        ok: false,
        state: 'failed',
        error: {
            code,
            message,
            ...(details === undefined ? {} : { details })
        }
    };
}
export function asRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
export function asString(value, fallback) {
    return typeof value === 'string' ? value : fallback ?? '';
}
export function asOptionalString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
export const KNOWLEDGE_SCOPE_PLACEHOLDERS = new Set(['default', 'current', 'active', 'workspace']);
export function resolveKnowledgeWorkspaceId(requestedValue, context) {
    const requested = asOptionalString(requestedValue)?.trim();
    const hostWorkspaceId = context.session?.meta.workspaceId
        ?? context.coreSession?.workspaceId
        ?? context.workspaceIndex?.workspaceId;
    // A host-created store is already bound to one workspace.  Never let a
    // model choose another scope; common placeholders are treated as omission
    // so a model can use the tool without guessing a host-generated id.
    if (hostWorkspaceId) {
        if (requested && !KNOWLEDGE_SCOPE_PLACEHOLDERS.has(requested) && requested !== hostWorkspaceId) {
            return {
                ok: false,
                result: fail('KNOWLEDGE_SCOPE_MISMATCH', '知识查询的 workspace scope 必须由当前宿主会话决定，不能读取其他工作区。', { requestedScope: 'redacted', activeScope: 'host-bound' })
            };
        }
        return { ok: true, workspaceId: hostWorkspaceId };
    }
    if (requested)
        return { ok: true, workspaceId: requested };
    return {
        ok: false,
        result: fail('INVALID_INPUT', '知识工具需要当前工作区 scope；请先打开工作区。')
    };
}
export function requireEditSession(context, purpose) {
    if (!context.session) {
        return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
    }
    if (context.editSession && context.editSession.session === context.session) {
        return { ok: true, session: context.editSession };
    }
    const backupBaseDir = context.backupBaseDir ?? join(context.session.layers.overlayRoot, '.soulforge-staging', 'backups');
    const recoveryDir = context.recoveryDir ?? join(context.session.layers.overlayRoot, '.soulforge-staging', 'recovery');
    return {
        ok: true,
        session: nativeEditSessionFromContext({
            session: context.session,
            operationLog: context.operationLogStore ?? getDefaultOperationLogStore(),
            backupBaseDir,
            recoveryDir,
            ...(context.confirmation ? { confirmation: context.confirmation } : {})
        })
    };
}
export function resolveHostResolvedEmevdEventTarget(context, input) {
    const value = asRecord(input);
    const file = typeof value.file === 'string' ? value.file.trim() : '';
    const eventId = typeof value.eventId === 'number' && Number.isSafeInteger(value.eventId)
        ? value.eventId
        : undefined;
    if (!file || eventId === undefined) {
        return {
            ok: false,
            code: 'INVALID_INPUT',
            message: 'EMEVD event identity 需要 file 与安全整数 eventId。'
        };
    }
    const resolved = resolveIndexedResourceFile(context, file, 'event');
    if (!resolved.ok)
        return resolved;
    const sourcePath = nativePathFromFileToken(resolved.path);
    return {
        ok: true,
        target: {
            resourceKind: 'event',
            sourceUri: resolved.sourceUri,
            sourcePath,
            eventId,
            canonical: resolved.canonical === true
        }
    };
}
export function nativePathFromFileToken(token) {
    if (!/^file:/iu.test(token))
        return token;
    try {
        return fileURLToPath(token);
    }
    catch {
        // Keep the original token so the native facade returns its structured
        // path diagnostic instead of silently guessing a different file.
        return token;
    }
}
/**
 * Resolve the model-facing file token against the current workspace catalog.
 * Search results expose a sourceUri, while models commonly pass only a logical
 * map id such as m10_00_00_00. Native readers need the actual indexed file;
 * silently guessing between base/overlay variants would be unsafe, so an
 * ambiguous logical id fails with the available source URIs.
 */
export function resolveIndexedResourceFile(context, input, resourceKind) {
    const token = input.trim();
    if (resourceKind === 'map' && !isLogicalMapToken(token) && !isMapPathToken(token)) {
        return {
            ok: false,
            code: 'MAP_RESOURCE_TYPE_MISMATCH',
            message: `地图工具只接受 .msb/.msb.dcx 或逻辑地图 ID；收到的资源不是 MSB：${token}`,
            details: { expected: ['map', 'msb', 'msb.dcx'] }
        };
    }
    const index = context.workspaceIndex;
    if (!index) {
        if (isLogicalMapToken(token)) {
            return {
                ok: false,
                code: 'MAP_SOURCE_REQUIRED',
                message: '逻辑地图 ID 不能直接作为文件；请先打开工作区并用 search_map_entities 获取 sourceUri。'
            };
        }
        return { ok: true, path: token, sourceUri: token, canonical: false };
    }
    const files = index.getFiles().filter((file) => file.resourceKind === resourceKind && isActiveSemanticSource(file));
    const normalized = normalizeFileToken(token);
    const direct = files.filter((file) => [file.sourceUri, file.sourcePath, file.relativePath, file.absolutePath]
        .some((candidate) => normalizeFileToken(candidate) === normalized));
    if (direct.length === 1) {
        return { ok: true, path: direct[0].absolutePath, sourceUri: direct[0].sourceUri, canonical: true };
    }
    if (direct.length > 1) {
        return ambiguousIndexedFiles(resourceKind, token, direct);
    }
    if (resourceKind === 'map') {
        const mapId = mapIdFromFileToken(token);
        if (mapId) {
            const byMapId = files.filter((file) => mapIdFromFileToken(file.relativePath) === mapId
                || mapIdFromFileToken(file.sourcePath) === mapId
                || mapIdFromFileToken(file.sourceUri) === mapId);
            if (byMapId.length === 1) {
                return { ok: true, path: byMapId[0].absolutePath, sourceUri: byMapId[0].sourceUri, canonical: true };
            }
            if (byMapId.length > 1)
                return ambiguousIndexedFiles(resourceKind, token, byMapId);
            if (isLogicalMapToken(token)) {
                return {
                    ok: false,
                    code: 'MAP_SOURCE_NOT_INDEXED',
                    message: `工作区索引中没有地图 ${mapId} 的 MSB 文件；请先检查资源索引。`
                };
            }
        }
    }
    // Preserve the existing path resolver for callers that already supplied a
    // concrete relative/absolute file but whose catalog is partial.
    return { ok: true, path: token, sourceUri: token, canonical: false };
}
export function canonicalScriptSourceUri(context, containerPath, fallback) {
    const index = context.workspaceIndex;
    if (index) {
        const normalized = normalizeFileToken(containerPath);
        const match = index.getFiles().find((file) => file.resourceKind === 'script' && [
            file.absolutePath,
            file.sourcePath,
            file.relativePath,
            file.sourceUri
        ].some((candidate) => normalizeFileToken(candidate) === normalized));
        if (match)
            return match.sourceUri;
    }
    return fallback && !/^[A-Za-z]:[\\/]/u.test(fallback) ? fallback : pathToFileURL(containerPath).href;
}
export function ambiguousIndexedFiles(resourceKind, token, files) {
    return {
        ok: false,
        code: resourceKind === 'map' ? 'MAP_SOURCE_AMBIGUOUS' : 'RESOURCE_SOURCE_AMBIGUOUS',
        message: `输入 ${token} 匹配多个 ${resourceKind} 文件；请使用搜索结果中的 sourceUri，而不是继续猜测。`,
        details: {
            candidates: files.map((file) => ({ sourceUri: file.sourceUri, relativePath: file.relativePath }))
        }
    };
}
export function normalizeFileToken(value) {
    return value.trim().replace(/\\/g, '/').toLocaleLowerCase();
}
export function isLogicalMapToken(value) {
    return /^m\d{2}_\d{2}_\d{2}_\d{2}(?:#.*)?$/iu.test(value.trim())
        || /^map:\/\/m\d{2}_\d{2}_\d{2}_\d{2}(?:\/|$)/iu.test(value.trim());
}
export function isMapPathToken(value) {
    return /\.msb(?:\.dcx)?$/iu.test(value.trim().split('#', 1)[0] ?? '');
}
export function mapIdFromFileToken(value) {
    const withoutFragment = value.trim().split('#', 1)[0] ?? '';
    const mapUri = withoutFragment.match(/^map:\/\/([^/]+)/iu);
    if (mapUri?.[1])
        return mapUri[1].toLocaleLowerCase();
    const leaf = withoutFragment.replace(/\\/g, '/').split('/').pop() ?? '';
    const mapId = leaf.replace(/\.msb(?:\.dcx)?$/iu, '');
    return /^m\d{2}_\d{2}_\d{2}_\d{2}$/iu.test(mapId) ? mapId.toLocaleLowerCase() : null;
}
export function nativeFormatHint(targetUri, targetPath) {
    const haystack = `${targetUri} ${targetPath}`.toLowerCase();
    if (/\.(parambnd|param)(\.dcx)?(\b|$)/.test(haystack) || haystack.includes('gameparam')) {
        return '这是 PARAM 容器，请用 read_param_fields / mutate_param_fields，不要走文本补丁。';
    }
    if (/\.(fmg|msgbnd)(\.dcx)?(\b|$)/.test(haystack)) {
        return '这是 FMG 文本表，请用 FMG 门面（mutate_fmg_entries），不要把词条当 UTF-8 文件覆盖。';
    }
    if (/\.emevd(\.dcx)?(\b|$)/.test(haystack)) {
        return '这是 EMEVD 事件，请用 apply_emevd_dsl，不要把二进制当文本补丁。';
    }
    if (/\.(anibnd|tae)(\.dcx)?(\b|$)/.test(haystack)) {
        return '这是 TAE 动作文档，请用 read_tae_events / mutate_tae_event_times，不要把 anibnd/tae 当文本补丁。';
    }
    if (/\.msb(\.dcx)?(\b|$)/.test(haystack)) {
        return '这是 MSB 地图文档，请用 read_msb_parts / mutate_msb_part_transform，不要把 msb 当文本补丁。';
    }
    if (/\.(dcx|bnd)\b/.test(haystack)) {
        return '这是打包原生格式，禁止 propose_text_patch。请用对应的 PARAM / FMG / EMEVD / 明文脚本门面。';
    }
    return null;
}
export function asIdList(value) {
    if (typeof value === 'number')
        return Number.isInteger(value) ? [value] : [];
    if (typeof value === 'string' && value.trim()) {
        const num = Number(value.trim());
        if (Number.isInteger(num))
            return [num];
    }
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => (typeof item === 'number' ? item : Number(item)))
        .filter((item) => Number.isInteger(item));
}
export function asStringList(value) {
    if (typeof value === 'string' && value.trim().length > 0)
        return [value.trim()];
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === 'string' && item.length > 0);
}
export function asEntityRelations(value) {
    if (!Array.isArray(value))
        return [];
    return value.flatMap((item) => {
        if (typeof item === 'string' && item.trim().length > 0)
            return [item.trim()];
        if (!item || typeof item !== 'object' || Array.isArray(item))
            return [];
        const record = item;
        if (typeof record.relation !== 'string' || record.relation.trim().length === 0)
            return [];
        return [{
                relation: record.relation.trim(),
                ...(typeof record.targetNamespace === 'string' && record.targetNamespace.trim().length > 0
                    ? { targetNamespace: record.targetNamespace.trim() }
                    : {}),
                ...(typeof record.ruleId === 'string' && record.ruleId.trim().length > 0
                    ? { ruleId: record.ruleId.trim() }
                    : {})
            }];
    });
}
export function asParamEdits(value) {
    const items = Array.isArray(value) ? value : (value && typeof value === 'object' && 'table' in value ? [value] : null);
    if (!items || items.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'mutate_param_fields 需要非空 edits 数组或单条 edit 对象。' };
    }
    const edits = [];
    for (const item of items) {
        const record = asRecord(item);
        const table = asString(record.table);
        const fieldId = asString(record.fieldId);
        const rowId = asNumber(record.rowId, Number.NaN);
        if (!table || !fieldId || !Number.isInteger(rowId)) {
            return { ok: false, code: 'INVALID_INPUT', message: '每条 edit 需要 table、rowId、fieldId、value。' };
        }
        const raw = record.value;
        if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean') {
            return { ok: false, code: 'INVALID_INPUT', message: `${table}#${rowId}.${fieldId} 的 value 必须是数字、字符串或布尔。` };
        }
        // T10 step 6: physical identity fields are carried through, never dropped.
        // A present-but-invalid rowIndex/expectedDataHash fails closed instead of
        // silently falling back to logical-row addressing.
        const edit = { table, rowId, fieldId, value: raw };
        if (record.rowIndex !== undefined) {
            if (typeof record.rowIndex !== 'number' || !Number.isSafeInteger(record.rowIndex) || record.rowIndex < 0) {
                return { ok: false, code: 'INVALID_INPUT', message: `${table}#${rowId}.${fieldId} 的 rowIndex 必须是非负安全整数。` };
            }
            edit.rowIndex = record.rowIndex;
        }
        if (record.expectedDataHash !== undefined) {
            if (typeof record.expectedDataHash !== 'string' || !/^[0-9a-fA-F]{16,128}$/.test(record.expectedDataHash.trim())) {
                return { ok: false, code: 'INVALID_INPUT', message: `${table}#${rowId}.${fieldId} 的 expectedDataHash 必须是完整的十六进制哈希值。` };
            }
            edit.expectedDataHash = record.expectedDataHash.trim();
        }
        edits.push(edit);
    }
    return { ok: true, edits };
}
export function asFmgEdits(value) {
    const items = Array.isArray(value) ? value : (value && typeof value === 'object' && 'table' in value ? [value] : null);
    if (!items || items.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'mutate_fmg_entries 需要非空 edits 数组或单条 edit 对象。' };
    }
    const edits = [];
    for (const item of items) {
        const record = asRecord(item);
        const table = asString(record.table);
        const text = typeof record.text === 'string' ? record.text : '';
        const id = asNumber(record.id, Number.NaN);
        if (!table || !Number.isInteger(id)) {
            return { ok: false, code: 'INVALID_INPUT', message: '每条 edit 需要 table、id、text。' };
        }
        if (typeof record.text !== 'string') {
            return { ok: false, code: 'INVALID_INPUT', message: `${table}#${id} 的 text 必须是字符串。` };
        }
        edits.push({ table, id, text });
    }
    return { ok: true, edits };
}
export function asTaeTimeEdits(value) {
    const items = Array.isArray(value) ? value : (value && typeof value === 'object' && 'address' in value ? [value] : null);
    if (!items || items.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'mutate_tae_event_times 的 edits 必须是数组或单条 edit 对象。' };
    }
    const edits = [];
    for (const item of items) {
        const record = asRecord(item);
        const address = asString(record.address);
        if (!address) {
            return { ok: false, code: 'INVALID_INPUT', message: '每条 edit 需要 address（格式 c1050#A0200.e0）。' };
        }
        const edit = { address };
        if (record.startFrame !== undefined) {
            const frame = asNumber(record.startFrame, Number.NaN);
            if (!Number.isFinite(frame))
                return { ok: false, code: 'INVALID_INPUT', message: `${address}.startFrame 必须是有限数字。` };
            edit.startFrame = frame;
        }
        if (record.endFrame !== undefined) {
            const frame = asNumber(record.endFrame, Number.NaN);
            if (!Number.isFinite(frame))
                return { ok: false, code: 'INVALID_INPUT', message: `${address}.endFrame 必须是有限数字。` };
            edit.endFrame = frame;
        }
        edits.push(edit);
    }
    return { ok: true, edits };
}
export function asTaeFieldEdits(value) {
    const items = Array.isArray(value) ? value : (value && typeof value === 'object' && 'address' in value ? [value] : null);
    if (!items || items.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'mutate_tae_event_fields 的 edits 必须是数组或单条 edit 对象。' };
    }
    const edits = [];
    for (const item of items) {
        const record = asRecord(item);
        const address = asString(record.address);
        if (!address)
            return { ok: false, code: 'INVALID_INPUT', message: '每条 TAE 字段 edit 需要 address。' };
        // `name` is the key read_tae_events used to return for a field; accept it as the same
        // selector instead of leaving the write with an empty fieldName.
        const fieldName = record.fieldName !== undefined
            ? asString(record.fieldName)
            : (record.name === undefined ? undefined : asString(record.name));
        const fieldIndex = record.fieldIndex === undefined ? undefined : asNumber(record.fieldIndex, Number.NaN);
        if (fieldName === undefined && fieldIndex === undefined) {
            return { ok: false, code: 'INVALID_INPUT', message: `${address} 需要 fieldIndex、fieldName 或 name（read_tae_events 返回的字段键名是 fieldName，旧版只给 name）。` };
        }
        if (fieldIndex !== undefined && (!Number.isSafeInteger(fieldIndex) || fieldIndex < 0)) {
            return { ok: false, code: 'INVALID_INPUT', message: `${address} 的 fieldIndex 必须是非负安全整数。` };
        }
        const raw = record.value;
        if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean') {
            return { ok: false, code: 'INVALID_INPUT', message: `${address} 的 value 必须是数字、字符串或布尔。` };
        }
        edits.push({
            address,
            ...(fieldIndex === undefined ? {} : { fieldIndex }),
            ...(fieldName === undefined ? {} : { fieldName }),
            value: raw
        });
    }
    return { ok: true, edits };
}
export const MSB_TRANSFORM_FIELDS = ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'];
export function asMsbTransformEdits(value) {
    const items = Array.isArray(value) ? value : (value && typeof value === 'object' && 'address' in value ? [value] : null);
    if (!items || items.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'mutate_msb_part_transform 的 edits 必须是数组或单条 edit 对象。' };
    }
    const edits = [];
    for (const item of items) {
        const record = asRecord(item);
        const address = asString(record.address);
        if (!address) {
            return { ok: false, code: 'INVALID_INPUT', message: '每条 edit 需要 address（格式 m11_01_00_00#c1050_0000）。' };
        }
        const edit = { address };
        if (record.nativeOffset !== undefined) {
            const nativeOffset = asNumber(record.nativeOffset, Number.NaN);
            if (!Number.isSafeInteger(nativeOffset) || nativeOffset < 0) {
                return { ok: false, code: 'INVALID_INPUT', message: `${address}.nativeOffset 必须是非负安全整数。` };
            }
            edit.nativeOffset = nativeOffset;
        }
        for (const field of MSB_TRANSFORM_FIELDS) {
            if (record[field] === undefined)
                continue;
            const raw = record[field];
            if (typeof raw !== 'number' || !Number.isFinite(raw)) {
                return { ok: false, code: 'INVALID_INPUT', message: `${address}.${field} 必须是有限数字。` };
            }
            Object.assign(edit, { [field]: raw });
        }
        edits.push(edit);
    }
    return { ok: true, edits };
}
export function asNumber(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed))
            return parsed;
    }
    return fallback;
}
/**
 * Cursor freshness identity for indexed event search. Hash only stable
 * candidate identity/provenance, not full instruction bodies, so minting or
 * validating a cursor does not recreate the historical Invalid string length
 * failure on large EMEVD bundles.
 */
export function eventSearchSnapshotHash(query, matches) {
    const hash = createHash('sha256');
    hash.update(`search-events:${query}\u0000${matches.length}\u0000`);
    for (const match of matches) {
        hash.update(match.item.uri);
        hash.update('\u0000');
        hash.update(String(match.score));
        hash.update('\u0000');
        hash.update(match.item.sourceHash ?? '');
        hash.update('\u0000');
        hash.update(match.item.sourceRevision === undefined ? '' : String(match.item.sourceRevision));
        hash.update('\u0001');
    }
    return `sha256:${hash.digest('hex')}`;
}
export function indexedEventSearchCoverage(context, query) {
    return {
        coverage: {
            scope: 'indexed-event-candidates', status: 'partial', negativeConclusionAllowed: false,
            domains: context.workspaceIndex?.getCoverageSnapshot().filter((item) => item.domain === 'event') ?? [],
            detail: '页数仅覆盖当前索引命中，不能证明所有来源的原生指令已经检索。'
        },
        nextActions: [{ tool: 'search_resources', args: { query: '.emevd', kinds: ['event'], limit: 6 },
                reason: `定位目标事件文件后，用 search_events 的 file + query=${query} 检索当前原生指令。` }]
    };
}
export async function searchScopedNativeEvents(context, file, query, limit, continuation) {
    if (!emevdEdit.isPreciseEmevdInstructionQuery(query))
        return fail('EMEVD_NATIVE_SEARCH_QUERY_NOT_PRECISE', '指定文件的原生搜索需要英文指令名或数字 ID。');
    // Parameter values are matched as whole tokens, so a one- or two-digit number would match almost
    // every instruction once values are in the haystack. Require three significant digits.
    if (/^\d+$/u.test(query.trim()) && query.trim().replace(/^0+/u, '').length < 3)
        return fail('EMEVD_NATIVE_SEARCH_QUERY_TOO_SHORT', '数字查询至少需要 3 位有效数字；更短的数字会命中几乎所有指令，请改用指令名或更长的数值。');
    const resolved = resolveIndexedResourceFile(context, file, 'event');
    if (!resolved.ok)
        return fail(resolved.code, resolved.message, resolved.details);
    const source = context.workspaceIndex?.getFiles().find((candidate) => candidate.sourceUri === resolved.sourceUri && isActiveSemanticSource(candidate));
    if (!source)
        return fail('EVENT_SOURCE_NOT_INDEXED', '请先用 search_resources 定位当前工作区中的活动 EMEVD 来源。');
    const edit = requireEditSession(context, 'read');
    if (!('session' in edit))
        return edit;
    const beforeHash = await hashEventSource(source.absolutePath, context.signal);
    if (continuation && continuation.sourceHash !== beforeHash)
        return fail('STALE_READ_CURSOR', '事件文件已改变，不能在新版本上继续旧窗口：请重新读取该事件后再继续。');
    const result = await emevdEdit.searchEmevdInstructionMatches({ edit: edit.session, files: [source], query, limit,
        offset: continuation?.offset ?? 0, ...(context.signal ? { signal: context.signal } : {}) });
    if (!result.ok)
        return fail(result.error.code, result.error.message, result.diagnostics);
    if (await hashEventSource(source.absolutePath, context.signal) !== beforeHash)
        return fail('STALE_READ_CURSOR', '搜索期间事件文件发生变化，请重读。');
    const nextCursor = result.truncated ? createScopedEventSearchCursor({ workspaceId: context.workspaceIndex.workspaceId,
        file: source.sourceUri, query }, beforeHash, result.offset + result.returned) : undefined;
    // A numeric query matched instruction names and ids but not every argument: searching 1100800
    // returned six instructions from one event and missed DisplayBossHealthBar(1, 1100800, ...) in
    // the next event, while coverage still said complete. A zero for a number must not read as
    // "this entity does not exist".
    const numericQuery = /^\d+$/u.test(query.trim());
    return ok({ ...result, authority: 'native-read-event-search', sourceUri: source.sourceUri, outerFileHash: beforeHash,
        ...(result.complete ? { total: result.offset + result.returned, totalCount: result.offset + result.returned } : {}),
        coverage: { scope: 'selected-source', status: result.complete ? 'complete' : 'partial', negativeConclusionAllowed: result.complete },
        ...(nextCursor ? { nextCursor } : {}),
        // matchesTotalCount is the size of this page: a round-14 agent read "6" as the total and concluded
        // 1300390 had six references in m13, when draining the cursor found 136 across 43 events. The note
        // says which one the number is, and a numeric query also says its own coverage.
        ...(numericQuery || !result.complete ? {
            note: [
                !result.complete ? 'matchesTotalCount 是本页条数，不是总数；用 nextCursor 逐页读到底再用 total/totalCount。' : undefined,
                numericQuery ? '数字查询只覆盖指令名/ID 与部分参数值；0 命中不代表该实体不存在——改用指令名搜索，或 read_emevd_event 精确读取该事件。' : undefined
            ].filter((part) => typeof part === 'string').join(' '),
            ...(numericQuery ? { coverage: { scope: 'selected-source', status: 'partial', negativeConclusionAllowed: false } } : {})
        } : {}),
        nextActions: nextCursor
            ? [{ tool: 'search_events', args: { cursor: nextCursor, limit }, reason: '继续读取此文件的原生指令命中；不是全工作区搜索。' }]
            : !result.complete ? [{ tool: 'search_events', args: { file: source.sourceUri, query, limit }, reason: '来源未完整读取；处理 diagnostics 后重试此文件，不得将本次空页当无匹配。' }] : [] });
}
export async function hashEventSource(file, signal) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file, signal ? { signal } : {}))
        hash.update(chunk);
    return hash.digest('hex');
}
export function nativeEventSearchSnapshotHash(query, files) {
    const hash = createHash('sha256');
    hash.update(`native-search-events:${query}\u0000`);
    for (const file of files
        .filter((item) => item.resourceKind === 'event')
        .sort((a, b) => a.sourceUri.localeCompare(b.sourceUri))) {
        hash.update(file.sourceUri);
        hash.update('\u0000');
        hash.update(file.sha256 ?? '');
        hash.update('\u0000');
        hash.update(String(file.mtimeMs));
        hash.update('\u0001');
    }
    return `sha256:${hash.digest('hex')}`;
}
export function scriptCatalogSnapshotHash(sourceUri, outerFileHash, scripts) {
    const hash = createHash('sha256');
    hash.update(`luabnd-scripts:${sourceUri}\u0000${outerFileHash}\u0000${scripts.length}\u0000`);
    for (const script of scripts) {
        hash.update(script.sanitizedName);
        hash.update('\u0000');
        hash.update(script.contentKind);
        hash.update('\u0000');
        hash.update(script.contentHash ?? '');
        hash.update('\u0001');
    }
    return `sha256:${hash.digest('hex')}`;
}
/**
 * CLI invocations are one-shot Node processes, so the in-memory read-session
 * table may not exist when a model feeds a cursor into the next invocation.
 * Recompute the bounded candidate list and accept the opaque offset only when
 * the source snapshot hash and scope still match. Desktop calls continue to
 * use NativeReadSessionManager; this is the restart-safe read-only fallback.
 */
export function resolveStatelessCursorPage(payload, currentSourceHash, items, limit, domain, scope) {
    if (payload.domain !== domain || payload.scope !== scope || payload.sourceHash !== currentSourceHash) {
        throw Object.assign(new Error('来源在游标签发后发生了变化（STALE_READ_CURSOR）：请从头重新读取后再继续。'), {
            code: 'STALE_READ_CURSOR'
        });
    }
    if (!Number.isSafeInteger(payload.offset) || payload.offset < 0) {
        throw Object.assign(new Error('游标偏移无效（INVALID_READ_CURSOR）：去掉 cursor 重新请求第一页即可。'), { code: 'INVALID_READ_CURSOR' });
    }
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const pageItems = items.slice(payload.offset, payload.offset + safeLimit);
    const nextOffset = payload.offset + pageItems.length;
    const hasMore = nextOffset < items.length;
    const nextCursor = hasMore
        ? createOpaqueCursor({
            sessionId: payload.sessionId,
            offset: nextOffset,
            sourceHash: currentSourceHash,
            domain,
            scope
        })
        : null;
    return { items: pageItems, offset: payload.offset, total: items.length, hasMore, nextCursor };
}
export function asResourceKinds(value) {
    if (!Array.isArray(value))
        return undefined;
    const allowed = new Set(ALL_RESOURCE_KINDS);
    const kinds = value.filter((item) => typeof item === 'string' && allowed.has(item));
    return kinds.length > 0 ? kinds : undefined;
}
export function asRagFamilies(value) {
    if (!Array.isArray(value))
        return undefined;
    const allowed = new Set(RAG_CHUNK_FAMILIES);
    const families = value.filter((item) => typeof item === 'string' && allowed.has(item));
    return families.length > 0 ? families : undefined;
}
export function resolveRagCorpus(context) {
    if (context.workspaceIndex) {
        const currentEpoch = context.workspaceIndex.getNativeVersionEpoch();
        const hasMatchingHostIdentity = typeof context.workspaceSessionId === 'string'
            && typeof context.ragSessionId === 'string'
            && context.ragSessionId === context.workspaceSessionId
            && typeof context.workspaceSessionGeneration === 'number'
            && typeof context.ragGeneration === 'number'
            && context.ragGeneration === context.workspaceSessionGeneration
            && typeof context.indexedFilesRevision === 'number'
            && typeof context.ragIndexedFilesRevision === 'number'
            && context.ragIndexedFilesRevision === context.indexedFilesRevision;
        // 主进程在一次分析/原生回读后注入带来源快照。优先复用同一 workspace
        // 的快照；如果每次 retrieve_evidence 都从 WorkspaceIndex 重建 18 万个
        // chunk，会把检索变成全局 CPU 放大器，尤其在并发 Agent 下会互相叠加。
        if (context.rag
            && context.rag.workspaceId === context.workspaceIndex.workspaceId
            && hasMatchingHostIdentity
            && context.ragEpoch === currentEpoch
            && context.ragScope === 'full') {
            const stats = context.workspaceIndex.getStats();
            const ragStats = context.rag.stats.byFamily;
            const taeEventCount = context.workspaceIndex.toSymbolBundle().tae?.reduce((total, exportItem) => total + exportItem.animations.reduce((animationTotal, animation) => animationTotal + animation.events.length, 0), 0) ?? 0;
            const ragMissingSymbols = (stats.files > 0 && ragStats.file === 0)
                || (stats.events > 0 && ragStats.event === 0)
                || (stats.mapEntities > 0 && ragStats.map_entity === 0)
                || (stats.mapRegions > 0 && ragStats.map_region === 0)
                || (stats.paramRows > 0 && ragStats.param_row === 0)
                || (stats.textEntries > 0 && ragStats.text_entry === 0)
                || (taeEventCount > 0 && ragStats.tae_event === 0);
            // Coverage status describes native authority/completeness, not whether
            // this already-prepared snapshot contains the families currently
            // available from the live index.  A partial native source can still
            // have a complete usable RAG projection for its available rows; reject
            // only when the live index exposes a family that the snapshot cannot
            // represent.  Rebuilding here would discard the host's prepared lookup
            // index on every first search after a partial native read.
            if (!ragMissingSymbols) {
                return context.rag;
            }
        }
        // A canonical PARAM snapshot is intentionally retained, while the live
        // index supplies native families that may finish after the first PARAM
        // stage.  This is also the safe fallback for snapshots without provenance:
        // stale persisted chunks are admitted only when mergeCatalogAndPersisted
        // can prove their source revision/hash against the current file catalog.
        const live = buildRagCorpus(context.workspaceIndex, undefined, [], undefined, undefined, {
            lookupIndex: 'deferred',
            families: ['file', 'event', 'map_entity', 'map_region', 'param_row', 'text_entry', 'tae_event']
        });
        if (context.rag && context.rag.chunks.length > 0) {
            return mergeCatalogAndPersisted(live, context.rag, { lookupIndex: 'deferred' });
        }
        return live;
    }
    if (context.rag && context.rag.chunks.length > 0)
        return context.rag;
    return null;
}
/** Normal desktop snapshots are prebuilt; legacy/live-merge fallbacks must not block main. */
export async function prepareRagQueryLookup(corpus, signal) {
    if (corpus?.availability === 'available') {
        // attachLookupIndexAsync validates the existing chunk/reference signatures;
        // a truthy cached index may still be stale after a mutable legacy corpus
        // changes. Never let retrieveEvidence perform the resulting rebuild inline.
        await attachLookupIndexAsync(corpus, { ...(signal ? { signal } : {}) });
    }
}
export function isWorkspaceContextCurrent(context) {
    try {
        return context.isWorkspaceContextCurrent?.() !== false;
    }
    catch {
        return false;
    }
}
/** Search-only action projection: original event chunks remain the evidence. */
async function groupTaeRagActions(corpus, families, excluded, signal) {
    const scope = normalizeRetrievalScope({ workspaceId: corpus.workspaceId, families }, families, corpus.workspaceId);
    const groups = new Map();
    let processed = 0;
    for (const chunk of corpus.chunks) {
        signal?.throwIfAborted();
        if (chunk.family === 'tae_event' && isChunkEligible(chunk, scope) && !excluded?.has(chunk.chunkId)) {
            const address = chunk.symbolUri.replace(/\/e\d+(?:[?#].*)?$/, '');
            const key = JSON.stringify([chunk.sourceUri, address]);
            const events = groups.get(key) ?? [];
            events.push(chunk);
            groups.set(key, events);
        }
        if (++processed % 128 === 0)
            await yieldRagGrouping();
    }
    const chunks = [];
    for (const events of groups.values()) {
        signal?.throwIfAborted();
        const first = events[0];
        const title = [...new Set(events.map(event => event.title))].join('\n');
        const body = events.map(event => event.body).join('\n');
        const numericIds = [...new Set(events.flatMap(event => event.numericIds))];
        chunks.push({ ...first, chunkId: `${first.chunkId}:action-search`,
            symbolUri: first.symbolUri.replace(/\/e\d+(?:[?#].*)?$/, ''), title, body, numericIds,
            contentHash: createHash('sha256').update(JSON.stringify([title, body, numericIds])).digest('hex') });
        if (chunks.length % 128 === 0)
            await yieldRagGrouping();
    }
    const byFamily = { ...corpus.stats.byFamily };
    for (const family of RAG_CHUNK_FAMILIES)
        byFamily[family] = family === 'tae_event' ? chunks.length : 0;
    return { corpus: { ...corpus, chunks, references: [], stats: { total: chunks.length, byFamily } }, groups };
}
/**
 * A query that lost its letters and digits — typically through a shell pipe that re-encoded it, so
 * "鬼形部" arrived as "???" — searched for nothing and still reported completeness "complete" with
 * zero evidence. That reads as "this object does not exist", which is the most expensive wrong answer
 * a search tool can give. Refuse it and name the cause instead.
 */
export function searchQueryUnusable(query) {
    if (query === undefined)
        return undefined;
    const trimmed = query.trim();
    if (trimmed === '')
        return undefined;
    if (/[\p{L}\p{N}]/u.test(trimmed))
        return undefined;
    return '查询里没有任何文字或数字（收到的是「' + trimmed + '」）。常见原因是 shell/管道把中文重新编码成了 ?；'
        + '请把参数写成 UTF-8 文件再传入（例如 call --stdin 用的 JSON 文件），或改用 ASCII 名称、ID。';
}
export async function ragSearchFallback(context, query, families, limit, toolName, paramNames) {
    const isParamWarmingUp = families.includes('param_row')
        && context.workspaceIndex?.getParamSemanticState?.() === 'warming_up';
    const corpus = resolveRagCorpus(context);
    const catalogHits = buildCatalogFallbackHits(context.workspaceIndex, query, families, limit);
    if (!corpus) {
        if (isParamWarmingUp) {
            return ok({
                status: 'warming_up',
                directive: 'DEFER_PARAM_QUERY',
                state: 'warming_up',
                source: 'rag-fallback',
                tool: toolName,
                query,
                availability: 'unavailable',
                totalHits: 0,
                hits: [],
                diagnostics: [],
                message: '【状态机调度】PARAM 语义索引当前正在后台解包预热中（尚未就绪）。请当前循环暂时跳过参数查询流程，优先执行其他可独立推进的任务（如 MSB 地图分析、EMEVD 事件逻辑校验、任务规划等）；请在下一次循环或后续步骤中再重新查询参数。'
            });
        }
        return ok({
            status: 'catalog-only',
            source: 'structured-catalog-fallback',
            tool: toolName,
            query,
            availability: 'unavailable',
            totalHits: catalogHits.length,
            hits: catalogHits,
            diagnostics: [{
                    severity: 'warning',
                    code: 'RAG_LOCAL_MODEL_UNAVAILABLE',
                    message: '当前没有可用的本地模型或语义语料；已回退到结构化文件目录候选，结果只能用于定位，不能作为原生语义证明。'
                }],
            note: catalogHits.length > 0
                ? '当前只有目录级结构化候选；请继续使用领域搜索和 native read。'
                : '目录级结构化候选也未命中；零命中不是资源不存在的证明。'
        });
    }
    const staleOptions = staleRagChunkOption(context, corpus);
    // Apply the search budget to unique actions, before event siblings can
    // consume retrieveEvidence's chunk limit (including its strict max of 32).
    const taeActions = toolName === 'search_tae_events'
        ? await groupTaeRagActions(corpus, families, staleOptions.excludeChunkMask, context.signal)
        : undefined;
    const searchCorpus = taeActions?.corpus ?? corpus;
    await prepareRagQueryLookup(searchCorpus, context.signal);
    if (!isWorkspaceContextCurrent(context)) {
        return fail('RAG_CONTEXT_STALE', '工作区会话或 RAG 语料已切换，已丢弃旧检索结果；请重试。');
    }
    const currentStaleOptions = staleRagChunkOption(context, corpus);
    if (taeActions && currentStaleOptions.excludeChunkMask !== staleOptions.excludeChunkMask) {
        return fail('RAG_CONTEXT_STALE', 'TAE 来源在汇总动作证据时发生变化：请重新读取该动作后再试。');
    }
    const result = retrieveEvidence(searchCorpus, query, {
        limit: Math.max(1, Math.min(100, Math.trunc(limit))),
        families,
        expandReferences: false,
        ...(taeActions ? {} : currentStaleOptions)
    });
    if (!result.ok) {
        if (result.code === 'RAG_UNAVAILABLE') {
            if (isParamWarmingUp) {
                return ok({
                    status: 'warming_up',
                    directive: 'DEFER_PARAM_QUERY',
                    state: 'warming_up',
                    source: 'rag-fallback',
                    tool: toolName,
                    query,
                    availability: corpus.availability,
                    totalHits: 0,
                    hits: [],
                    diagnostics: corpus.diagnostics,
                    message: '【状态机调度】PARAM 语义索引当前正在后台解包预热中（尚未就绪）。请当前循环暂时跳过参数查询流程，优先执行其他可独立推进的任务（如 MSB 地图分析、EMEVD 事件逻辑校验、任务规划等）；请在下一次循环或后续步骤中再重新查询参数。'
                });
            }
            // A semantic corpus can be present but unavailable when its last build
            // failed or is still partial. Keep the structured file catalog usable in
            // that state as well; returning only RAG_UNAVAILABLE made a clean local
            // workspace look completely unsearchable and encouraged agents to loop.
            if (catalogHits.length > 0) {
                return ok({
                    status: 'catalog-only',
                    source: 'structured-catalog-fallback',
                    tool: toolName,
                    query,
                    availability: corpus.availability,
                    totalHits: catalogHits.length,
                    hits: catalogHits,
                    diagnostics: [
                        ...corpus.diagnostics,
                        {
                            severity: 'warning',
                            code: result.code,
                            message: result.message
                        }
                    ],
                    note: '语义语料当前不可用；已返回结构化文件候选，必须继续使用领域搜索和 native read，不能把零命中解释为资源不存在。'
                });
            }
            return fail(result.code, result.message, {
                ragAvailability: corpus.availability,
                ragStats: corpus.stats,
                diagnostics: corpus.diagnostics
            });
        }
        return ok({
            source: 'rag-fallback',
            tool: toolName,
            query,
            availability: corpus.availability,
            totalHits: 0,
            hits: [],
            diagnostics: corpus.diagnostics,
            note: result.message
        });
    }
    const allowedParams = paramNames && paramNames.length > 0
        ? new Set(paramNames.map(normalizeParamNameForFallback))
        : null;
    const hits = result.hits.filter((hit) => {
        if (allowedParams === null || hit.chunk.family !== 'param_row')
            return true;
        // RAG chunk 同时保留原生表名和物理文件身份；参数表过滤沿用
        // 原生候选搜索的大小写、标点和 _ST 归一化，避免误把有效候选过滤掉。
        const haystack = normalizeParamSearchText(`${hit.chunk.title}\n${hit.chunk.body}`);
        return [...allowedParams].some((paramName) => haystack.includes(paramName));
    });
    if (toolName === 'search_tae_events') {
        const keys = new Map();
        for (const hit of hits) {
            const address = hit.chunk.symbolUri.replace(/\/e\d+(?:[?#].*)?$/, '');
            const key = JSON.stringify([hit.chunk.sourceUri, address]);
            if (!keys.has(key))
                keys.set(key, { sourceUri: hit.chunk.sourceUri, address, score: hit.score });
        }
        const actions = [...keys.values()].slice(0, Math.max(1, limit)).map((action) => {
            const events = (taeActions?.groups.get(JSON.stringify([action.sourceUri, action.address])) ?? corpus.chunks.filter((chunk) => chunk.family === 'tae_event'
                && chunk.sourceUri === action.sourceUri && chunk.symbolUri.replace(/\/e\d+(?:[?#].*)?$/, '') === action.address)).slice()
                .sort((a, b) => Number(/\/e(\d+)/.exec(a.symbolUri)?.[1] ?? 0) - Number(/\/e(\d+)/.exec(b.symbolUri)?.[1] ?? 0));
            const size = Math.max(1, Math.min(16, Math.floor(20000 / Math.max(1, ...events.map((event) => Buffer.byteLength(JSON.stringify(event), 'utf8'))))));
            const nativeCounts = new Set(events.map(e => e.taeActionEventCount).filter((n) => n !== undefined));
            const totalCount = nativeCounts.size === 1 ? [...nativeCounts][0] : null;
            const indexedEventsComplete = totalCount !== null && totalCount === events.length && events.every(e => e.taeActionEventsComplete === true);
            const delivered = events.slice(0, size);
            const eventsComplete = indexedEventsComplete && delivered.length === totalCount;
            return { ...action, evidence: 'rag-candidate', events: delivered, indexedEventsComplete, eventsComplete, eventsTruncated: !eventsComplete,
                pagination: { offset: 0, totalCount, returnedCount: Math.min(size, events.length),
                    pageNumber: 1, totalPages: totalCount === null ? null : Math.ceil(totalCount / size), hasMore: !eventsComplete || events.length > size,
                    nextRead: { tool: 'read_tae_events', args: { file: action.sourceUri, addresses: [action.address], pageSize: size } } } };
        });
        return ok({ source: 'rag-fallback', tool: toolName, query, availability: corpus.availability,
            totalHits: actions.length, hits: actions, diagnostics: corpus.diagnostics,
            note: '动作级 RAG 候选包含同一动作的词条证据；必须继续原生读取确认完整内容和当前来源。' });
    }
    return ok({
        source: 'rag-fallback',
        tool: toolName,
        query,
        availability: corpus.availability,
        totalHits: hits.length,
        hits,
        diagnostics: corpus.diagnostics,
        note: '原生专用搜索未命中；以上是已校验来源的 RAG 候选，只能用于定位，必须继续原生读取确认。'
    });
}
export function buildCatalogFallbackHits(index, query, families, limit) {
    if (!index)
        return [];
    const allowedKinds = new Set();
    for (const family of families) {
        if (family === 'param_row')
            allowedKinds.add('param');
        if (family === 'text_entry')
            allowedKinds.add('msg');
        if (family === 'event')
            allowedKinds.add('event');
        if (family === 'map_entity' || family === 'map_region')
            allowedKinds.add('map');
        if (family === 'tae_event') {
            allowedKinds.add('action');
            allowedKinds.add('chr');
        }
    }
    const results = index.searchResources({
        query,
        limit: Math.max(1, Math.min(100, Math.trunc(limit))),
        ...(allowedKinds.size > 0 ? { kinds: [...allowedKinds] } : {})
    });
    return results.map(({ item, score }) => ({
        chunk: {
            chunkId: `catalog:${item.id}`,
            workspaceId: item.workspaceId,
            sourceUri: item.sourceUri,
            symbolUri: item.sourceUri,
            family: 'file',
            title: item.relativePath,
            body: `${item.resourceKind} ${item.formatLabel}`,
            numericIds: [],
            contentHash: item.sha256 ?? '',
            sourceRevision: item.mtimeMs,
            relativePath: item.relativePath,
            resourceKind: item.resourceKind,
            confidence: 'low'
        },
        score,
        reasons: ['structured-file-catalog'],
        excerpt: `${item.relativePath} · ${item.formatLabel}`,
        evidence: {
            status: 'summary_only',
            authority: 'structured-index',
            writeAllowed: false
        }
    }));
}
export function staleRagChunkOption(context, corpus) {
    if (!corpus)
        return {};
    const index = context.workspaceIndex;
    if (!index || index.workspaceId !== corpus.workspaceId)
        return {};
    const staleChunkMask = getRagStaleChunkMaskCached(index, corpus);
    return staleChunkMask ? { excludeChunkMask: staleChunkMask } : {};
}
export function normalizeParamNameForFallback(value) {
    const normalized = value
        .replace(/\\/gu, '/')
        .split('/')
        .pop()
        .replace(/\.param$/iu, '')
        .replace(/[^a-z0-9]+/giu, '')
        .toLocaleLowerCase();
    return normalized.endsWith('st') && normalized.length > 2
        ? normalized.slice(0, -2)
        : normalized;
}
export function normalizeParamSearchText(value) {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '');
}
export function asReferenceDirection(value) {
    return value === 'from' || value === 'to' || value === 'both' ? value : 'both';
}
/** Handler-side normalizer for read_flver.section; an unknown value fails closed. */
export function asFlverSection(value) {
    return value === 'meshes' || value === 'materials' || value === 'texture-slots' || value === 'bones'
        ? value
        : '__unaccepted__';
}
export function asPatchMode(value, fallback) {
    if (value === 'plan' || value === 'normal' || value === 'fullPermission')
        return value;
    return fallback;
}
/**
 * Handler-side normalizers for every `enum:`-declared field, keyed
 * `toolName.fieldName`. Exported so the schema gate can prove each declared
 * value is actually accepted rather than silently defaulted.
 *
 * A declaration is free to list a value the handler does not accept — that
 * costs nothing at compile time and nothing at runtime, but it makes the model
 * pass a value it believes is legal and receive a different one. Reading the
 * real normalizers (instead of restating the accepted sets in the gate) keeps
 * that check from becoming a second copy that drifts.
 */
export const ENUM_FIELD_NORMALIZERS = {
    'find_references.direction': (value) => asReferenceDirection(value),
    'read_flver.section': (value) => asFlverSection(value),
    'find_references.detail': (value) => (value === 'edges' || value === 'context' ? value : '__unaccepted__'),
    'read_emevd_event.format': (value) => (value === 'darkscript' || value === 'json' ? value : '__unaccepted__'),
    // asPatchMode falls back to the session mode. Probing with a sentinel
    // fallback keeps every declared value testable — using a real mode as the
    // fallback would make that one value indistinguishable between "accepted"
    // and "rejected then defaulted".
    'propose_text_patch.mode': (value) => asPatchMode(value, '__unaccepted__'),
    'apply_emevd_dsl.mode': (value) => (value === 'patch' || value === 'dark-script' ? value : '__unaccepted__'),
    'apply_emevd_dsl.scope': (value) => (value === 'file' || value === 'event' ? value : '__unaccepted__'),
    // The handler passes any string through (`typeof === 'string'`), so all
    // declared values are accepted. The declaration is deliberately narrower
    // than the handler here: narrowing only under-promises to the model, which
    // is the safe direction. assessEditRisk itself only branches on
    // 'unsupported' / 'failed' (writerContract.ts:273).
    'assess_edit_risk.parseStatus': (value) => value,
    'assess_edit_risk.changeKind': (value) => (value === 'structured' || value === 'binary' ? value : 'text'),
    // `origin` selects the read layer (workspace overlay or the game base root). parseReadOrigin accepts exactly these
    // two values and rejects anything else with INVALID_ORIGIN, so the sentinel is what an unknown value reaches.
    'read_param_fields.origin': (value) => (value === 'workspace' || value === 'base' ? value : '__unaccepted__'),
    'read_emevd_event.origin': (value) => (value === 'workspace' || value === 'base' ? value : '__unaccepted__'),
    'read_tae_events.origin': (value) => (value === 'workspace' || value === 'base' ? value : '__unaccepted__'),
    'list_container_entries.origin': (value) => (value === 'workspace' || value === 'base' ? value : '__unaccepted__')
};
/**
 * Standalone scripts are read as one document, not as prose snippets.
 *
 * Measured over the standalone .hks files of a real Sekiro install (78 files,
 * bytecode or plaintext, decoded to source by the first-party Bridge): 2,073 /
 * 36,423 / 506,571 characters for min / median / max. The old 2,400-character
 * default showed 4.7% of c0000.hks (50,781 chars) and the old 3,200-byte page
 * ceiling meant even sourceLimit:16000 could not do better, so reading one script
 * took dozens of calls. One page now carries as much text as the Agent envelope
 * allows (54,000 bytes of JSON text + ~4 KB identity), which returns most scripts
 * whole and the rest in a handful of pages. Paging and sourceTextComplete are
 * unchanged and still honest.
 */
const HKS_SOURCE_TEXT_DEFAULT_LIMIT = 65_536;
const HKS_SOURCE_TEXT_MAX_LIMIT = 65_536;
const HKS_SOURCE_TEXT_JSON_BUDGET = 54_000;
/** Shared domain implementation; read/search declarations live in separate modules. */
export function createStandaloneHksHandler(name) {
    return async (input, context) => {
        const value = asRecord(input);
        const file = asString(value.file);
        if (!file || !/\.(hks|lua)$/iu.test(file))
            return fail('SCRIPT_SOURCE_REQUIRED', '需要工作区内独立 .hks/.lua 文件，不接受容器或其它二进制格式。');
        const resolved = resolveIndexedResourceFile(context, file, /\.hks$/iu.test(file) ? 'action' : 'script');
        if (!resolved.ok)
            return fail(resolved.code, resolved.message, resolved.details);
        if (!resolved.canonical)
            return fail('SCRIPT_SOURCE_NOT_INDEXED', '请先用 search_resources 定位当前工作区中的脚本。');
        const edit = requireEditSession(context, 'read');
        if (!('session' in edit))
            return edit;
        const source = await readHksSource({ edit: edit.session, file: resolved.path, ...(context.signal ? { signal: context.signal } : {}) });
        if (!source.ok)
            return fail(source.code, source.message, source.diagnostics);
        if (value.expectedSourceHash !== undefined && value.expectedSourceHash !== source.sourceHash)
            return fail('STALE_READ_CURSOR', '源码已改变，请重新搜索或读取。');
        const identity = { sourceUri: resolved.sourceUri, sourceHash: source.sourceHash, outerFileHash: source.sourceHash,
            // Logical workspace path (no drive letter): proof identities resolve it against the overlay root.
            relativePath: resolved.sourceUri.replace(/^file:\/\//iu, ''),
            representation: source.representation, encoding: source.encoding, game: context.session?.meta.game,
            resourceKind: /\.hks$/iu.test(file) ? 'action' : 'script', diagnostics: source.diagnostics,
            evidenceLayers: { resource: 'source-read', logic: 'source-only', runtime: 'not-run' } };
        const sourceKey = `${context.workspaceIndex.workspaceId}|${resolved.sourceUri}`;
        try {
            if (name === 'read_hks_script') {
                const page = sourceTextPage({ text: source.sourceText, sourceKey, sourceHash: source.sourceHash, domain: 'script',
                    defaultLimit: HKS_SOURCE_TEXT_DEFAULT_LIMIT,
                    maxLimit: HKS_SOURCE_TEXT_MAX_LIMIT,
                    jsonBudget: HKS_SOURCE_TEXT_JSON_BUDGET,
                    ...(typeof value.sourceOffset === 'number' ? { sourceOffset: value.sourceOffset } : {}),
                    ...(typeof value.sourceLimit === 'number' ? { sourceLimit: value.sourceLimit } : {}),
                    ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}) });
                return ok({ ...identity, ...page, nextActions: page.nextCursor ? [{ tool: name,
                            args: { file: resolved.sourceUri, cursor: page.nextCursor }, reason: '继续读取同一版本的脚本原文。' }] : [] });
            }
            const page = literalSourceSearchPage({ text: source.sourceText, sourceKey, sourceHash: source.sourceHash, query: asString(value.query),
                ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}), ...(typeof value.limit === 'number' ? { limit: value.limit } : {}) });
            return ok({ ...identity, ...page, matches: page.matches.map((match) => ({ ...match,
                    sourceUri: resolved.sourceUri, readAction: { tool: 'read_hks_script', args: { file: resolved.sourceUri,
                            sourceOffset: match.sourceOffset, sourceLimit: 2400, expectedSourceHash: source.sourceHash } } })),
                nextActions: page.nextCursor ? [{ tool: name, args: { file: resolved.sourceUri, query: page.query, cursor: page.nextCursor, limit: page.limit }, reason: '继续查找后续精确文本命中。' }] : [] });
        }
        catch (error) {
            return fail(error.code ?? 'SCRIPT_SOURCE_WINDOW_FAILED', String(error));
        }
    };
}
/**
 * A diagnostic that echoes unbounded caller input turns one bad call into a huge response: a 50 KB
 * uri came back verbatim in an EVENT_NOT_FOUND message, and 5000 missing part names were listed in
 * full. Clip the echo; the caller already knows what it sent.
 */
export function clipForMessage(value, maxChars = 120) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}…（共 ${text.length} 字符）`;
}
/**
 * Resolve a model-facing file token against the current workspace catalog.
 *
 * Native readers need a host path, while the model usually holds a logical
 * `sourceUri` or a workspace-relative path. An exact token match against the
 * catalog is preferred; an ambiguous match must fail with the candidate list
 * rather than silently picking one. A token the catalog does not know keeps
 * its logical identity only when it is relative: an absolute host path has no
 * workspace form and must not be echoed back as a sourceUri.
 *
 * The container listing and the TPF reader share this rule; keeping one
 * implementation prevents the two from drifting on ambiguity and on the
 * absolute-path case.
 */
export function resolveWorkspaceFileToken(context, input, options = {}) {
    const token = input.trim();
    const normalized = normalizeFileToken(token);
    const index = context.workspaceIndex;
    if (index) {
        const direct = index.getFiles().filter((candidate) => [candidate.sourceUri, candidate.sourcePath, candidate.relativePath, candidate.absolutePath]
            .some((value) => normalizeFileToken(value) === normalized));
        if (direct.length === 1)
            return { ok: true, path: direct[0].absolutePath, sourceUri: direct[0].sourceUri };
        if (direct.length > 1) {
            return {
                ok: false,
                code: options.ambiguousCode ?? 'RESOURCE_SOURCE_AMBIGUOUS',
                message: options.ambiguousMessage ?? `file 同时匹配 ${direct.length} 个工作区文件；请传绝对路径或 sourceUri。`,
                details: { candidates: direct.slice(0, 8).map((candidate) => candidate.sourceUri) }
            };
        }
    }
    const absolute = isAbsolute(token)
        ? token
        : context.session?.layers.overlayRoot
            ? join(context.session.layers.overlayRoot, token)
            : token;
    return { ok: true, path: absolute, ...(isAbsolute(token) ? {} : { sourceUri: token }) };
}
/** Serialized-byte budget for one model-facing page of native rows. */
export const TOOL_ROW_PAGE_BUDGET_BYTES = 44 * 1024;
/**
 * Page native rows by the serialized size of the page that will actually be
 * sent, not only by row count: one long texture name or one 255-value GPARAM
 * parameter must not push the Agent envelope over its byte limit. An
 * over-budget single row is still returned (a page of zero rows would read as
 * "nothing here"), and `hasMore`/`nextOffset` always describe the rows the
 * Bridge actually returned.
 */
export function paginateToolRows(rows, offset, limit, rowOverheadBytes = 8) {
    const start = Math.max(0, Math.min(offset, rows.length));
    let bytes = 0;
    let count = 0;
    while (count < rows.length - start && count < limit) {
        const rowBytes = Buffer.byteLength(JSON.stringify(rows[start + count]), 'utf8') + rowOverheadBytes;
        if (count > 0 && bytes + rowBytes > TOOL_ROW_PAGE_BUDGET_BYTES)
            break;
        bytes += rowBytes;
        count += 1;
    }
    const pageRows = rows.slice(start, start + count);
    const totalCount = rows.length;
    const hasMore = start + pageRows.length < totalCount;
    const nextOffset = hasMore ? start + pageRows.length : undefined;
    const remainingCount = totalCount - start - pageRows.length;
    return {
        rows: pageRows,
        offset: start,
        limit,
        returnedCount: pageRows.length,
        totalCount,
        remainingCount,
        hasMore,
        ...(nextOffset === undefined ? {} : { nextOffset }),
        truncated: hasMore,
        pagination: {
            offset: start,
            limit,
            returnedCount: pageRows.length,
            totalCount,
            remainingCount,
            hasMore,
            ...(nextOffset === undefined ? {} : { nextOffset })
        }
    };
}
//# sourceMappingURL=toolRegistrySupport.js.map