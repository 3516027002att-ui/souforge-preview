/** T11 CLI 本地会话：同一进程复用 CoreToolSession；写入经统一注册表门禁。 */
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openWorkspaceSession } from '../workspace/workspaceSession.js';
import { scanWorkspace } from '../workspace/scanWorkspace.js';
import { WorkspaceIndex } from '../indexing/workspaceIndex.js';
import { analyzeWorkspace } from '../pipeline/workspacePipeline.js';
import { MemoryOperationLogStore } from '../patch/operationLog.js';
import { openSqliteOperationLogStore } from '../patch/sqliteOperationLogStore.js';
import { createDefaultToolRegistry } from '../ai/toolRegistry.js';
import { createAgentToolBridge } from '../ai/agentToolBridge.js';
import { createAgentBridgeBaseContext, createAgentCoreToolSession, createAgentToolContextProvider } from '../model-services/agentHostComposition.js';
import { disposeBridgeDaemonPool } from '../bridge/runBridge.js';
import { KnowledgeStore } from '../knowledge/knowledgeStore.js';
import { SqliteKnowledgeStorePersistence } from '../knowledge/sqliteKnowledgeStore.js';
import { createManagedReferenceCursorStore } from '../references/referenceCursorStore.js';
import { openWorkspaceDatabase } from '../storage/sqliteDatabase.js';
import { WorkspaceDataRepository } from '../storage/workspaceDataRepository.js';
import { localApplicationDataDirectory } from '../storage/localApplicationData.js';
import { createConfirmationReceipt } from '../patch/writerContract.js';
import { extractFileSymbolBundle, hasLegacyMapProjectionWithoutNativeOffset, isNativeSemanticBundleCurrent } from '../workspace/semanticFileCache.js';
const consumedPatchAuthorizations = new WeakSet();
const consumedRollbackAuthorizations = new WeakSet();
export function createCliRollbackAuthorization(input) {
    const operationId = input.operationId.trim();
    const workspaceId = input.workspaceId.trim();
    if (!operationId || !workspaceId)
        throw new Error('CLI_ROLLBACK_CONFIRMATION_INPUT_INVALID');
    return Object.freeze({
        operationId,
        workspaceId,
        receipt: createConfirmationReceipt({
            subjects: [`ROLLBACK_OPERATION:${operationId}`, `ROLLBACK_WORKSPACE:${workspaceId}`],
            riskLevel: 'high',
            sourceUri: workspaceId,
            note: 'CLI --confirm-rollback 显式授权；绑定当前 workspace 与单个 operationId。',
            policyTags: ['CLI_EXPLICIT_ROLLBACK_CONFIRMATION', 'ONE_SHOT']
        })
    });
}
/** `--confirm-patch <opId>` is the CLI approval channel for a proposal commit. */
export function createCliPatchAuthorization(input) {
    const operationId = input.operationId.trim();
    const workspaceId = input.workspaceId.trim();
    return {
        operationId,
        workspaceId,
        receipt: createConfirmationReceipt({
            subjects: [`PATCH_OP:${operationId}`, `PATCH_WORKSPACE:${workspaceId}`],
            riskLevel: 'high',
            sourceUri: workspaceId,
            note: 'CLI --confirm-patch 显式授权；绑定当前 workspace 与单个 proposal opId。',
            policyTags: ['CLI_EXPLICIT_PATCH_CONFIRMATION', 'ONE_SHOT']
        })
    };
}
export function consumeCliPatchAuthorization(authorization, operationId, workspaceId) {
    if (!authorization) {
        return {
            ok: false,
            code: 'EDIT_CONFIRMATION_REQUIRED',
            message: 'CLI 提交提案需要启动时显式提供 --confirm-patch <opId>。'
        };
    }
    if (authorization.operationId !== operationId.trim() || authorization.workspaceId !== workspaceId.trim()) {
        return {
            ok: false,
            code: 'CLI_PATCH_CONFIRMATION_MISMATCH',
            message: 'CLI 提交确认凭据未绑定当前 workspace 或 proposal opId。'
        };
    }
    if (consumedPatchAuthorizations.has(authorization)) {
        return {
            ok: false,
            code: 'CLI_PATCH_CONFIRMATION_REPLAYED',
            message: 'CLI 提交确认凭据已经使用，不能重放。'
        };
    }
    consumedPatchAuthorizations.add(authorization);
    return { ok: true, confirmation: authorization.receipt };
}
export function consumeCliRollbackAuthorization(authorization, operationId, workspaceId) {
    if (!authorization) {
        return {
            ok: false,
            code: 'EDIT_CONFIRMATION_REQUIRED',
            message: 'CLI rollback 需要启动时显式提供 --confirm-rollback <opId>。'
        };
    }
    if (authorization.operationId !== operationId.trim() || authorization.workspaceId !== workspaceId.trim()) {
        return {
            ok: false,
            code: 'CLI_ROLLBACK_CONFIRMATION_MISMATCH',
            message: 'CLI rollback 确认凭据未绑定当前 workspace 或 operationId。'
        };
    }
    if (consumedRollbackAuthorizations.has(authorization)) {
        return {
            ok: false,
            code: 'CLI_ROLLBACK_CONFIRMATION_REPLAYED',
            message: 'CLI rollback 确认凭据已经使用，不能重放。'
        };
    }
    consumedRollbackAuthorizations.add(authorization);
    return { ok: true, confirmation: authorization.receipt };
}
function cliToolFailure(code, message) {
    return {
        ok: false,
        code,
        content: JSON.stringify({ ok: false, error: { code, message } })
    };
}
export function cliWorkspaceRoot(workspaceId) {
    const key = createHash('sha256').update(workspaceId).digest('hex').slice(0, 24);
    // Match the production E2E host's isolated workspace database root so the
    // local CLI can inspect/recover a preserved overlay after the Electron main
    // process exits unexpectedly.
    const isolatedRoot = process.env.SF_E2E_WORKSPACE_STORAGE_ROOT?.trim();
    if (isolatedRoot)
        return join(resolve(isolatedRoot), key);
    const local = localApplicationDataDirectory();
    return join(local, 'SoulForge', 'cli-workspaces', key);
}
export async function openLocalCliSession(options) {
    const emit = (event) => options.onDiagnostic?.(event);
    const measured = async (phase, operation) => {
        const startedAt = Date.now();
        emit({ phase, status: 'start' });
        try {
            const result = await operation();
            emit({ phase, status: 'complete', elapsedMs: Date.now() - startedAt });
            return result;
        }
        catch (error) {
            emit({
                phase,
                status: 'failed',
                elapsedMs: Date.now() - startedAt,
                details: { message: error instanceof Error ? error.message : String(error) }
            });
            throw error;
        }
    };
    const session = await measured('workspace.open', () => openWorkspaceSession({
        overlayRoot: options.overlayRoot,
        ...(options.baseRoot ? { baseRoot: options.baseRoot } : {}),
        game: options.game ?? 'sekiro'
    }));
    const workspaceId = session.meta.workspaceId;
    // A base that is not an install root cannot answer "what does the game ship?": pointing --base
    // at mods/<something> makes origin:"base" return the Mod's bytes, and the caller has no way to
    // tell from the value alone. Warn once at open (the design permits any directory as base, so
    // this is a diagnostic, not a refusal).
    if (session.layers.baseRoot) {
        const base = session.layers.baseRoot;
        if (!existsSync(join(base, 'sekiro.exe'))) {
            options.onFallbackWarning?.(`CLI_BASE_NOT_GAME_ROOT: --base 指向的目录里没有 sekiro.exe（${base}）。`
                + 'origin:"base" 会把该目录里的文件当成「原版」，若它其实是 mods，对照结果是错的。'
                + '--base 应指向只狼安装根（其下直接是 event/、param/、chr/）。');
        }
        if (!existsSync(join(base, 'oo2core_6_win64.dll'))) {
            options.onFallbackWarning?.(`CLI_BASE_OODLE_MISSING: --base 目录里没有 oo2core_6_win64.dll（${base}）：KRAK 压缩的原版资源将无法解压，`
                + '相关读取会以 DCX_COMPRESSION_UNAVAILABLE 失败。');
        }
    }
    const patchAuthorization = options.confirmPatchOpId?.trim()
        ? createCliPatchAuthorization({ operationId: options.confirmPatchOpId, workspaceId })
        : undefined;
    const rollbackAuthorization = options.confirmRollbackOpId?.trim()
        ? createCliRollbackAuthorization({ operationId: options.confirmRollbackOpId, workspaceId })
        : undefined;
    const shouldAnalyze = options.analyze !== false;
    const useCache = options.useCache !== false && shouldAnalyze;
    const root = cliWorkspaceRoot(workspaceId);
    await mkdir(join(root, 'staging'), { recursive: true });
    await mkdir(join(root, 'backups'), { recursive: true });
    await mkdir(join(root, 'recovery'), { recursive: true });
    let semanticDatabase = null;
    let semanticCache;
    let semanticCacheHits = 0;
    let semanticCacheMisses = 0;
    let semanticCacheSaves = 0;
    if (useCache) {
        try {
            semanticDatabase = openWorkspaceDatabase(join(root, 'workspace.db'));
            const repository = new WorkspaceDataRepository(semanticDatabase, workspaceId);
            semanticCache = {
                load: (file) => {
                    if (!file.sha256) {
                        semanticCacheMisses += 1;
                        return null;
                    }
                    const row = repository.getSemanticFileCacheRow(file.relativePath);
                    if (!row || row.resourceKind !== file.resourceKind || row.fileSha256 !== file.sha256) {
                        semanticCacheMisses += 1;
                        return null;
                    }
                    try {
                        const payload = JSON.parse(row.payloadJson);
                        if (!isNativeSemanticBundleCurrent(file, payload)) {
                            // 旧地图索引没有 nativeOffset；重名 part 的地址不唯一。明确告知重建，
                            // 而不是静默当作未命中让调用方以为索引还是旧的。
                            if (hasLegacyMapProjectionWithoutNativeOffset(payload)) {
                                emit({
                                    phase: 'workspace.index.migration',
                                    status: 'complete',
                                    details: {
                                        code: 'MAP_INDEX_REBUILD_REQUIRED',
                                        severity: 'warning',
                                        sourceUri: file.sourceUri,
                                        message: '旧索引的 map 投影缺少 nativeOffset（同名 part 无法用地址/uri 唯一寻址），'
                                            + '已丢弃该语义缓存并从原生文件重建；源文件与修改记录未受影响。'
                                    }
                                });
                            }
                            semanticCacheMisses += 1;
                            return null;
                        }
                        semanticCacheHits += 1;
                        return payload;
                    }
                    catch {
                        semanticCacheMisses += 1;
                        return null;
                    }
                },
                save: (file, payload) => {
                    if (!file.sha256)
                        return;
                    repository.upsertSemanticFileCache({
                        relativePath: file.relativePath,
                        fileSha256: file.sha256,
                        resourceKind: file.resourceKind,
                        payload,
                        mtimeMs: file.mtimeMs
                    });
                    semanticCacheSaves += 1;
                }
            };
        }
        catch (error) {
            options.onFallbackWarning?.(`CLI_SEMANTIC_CACHE_UNAVAILABLE: 语义缓存数据库不可用，将执行当前会话的原生分析：${error instanceof Error ? error.message : String(error)}`);
            try {
                semanticDatabase?.close();
            }
            catch { /* ignore */ }
            semanticDatabase = null;
        }
    }
    const scan = await measured('workspace.scan', () => scanWorkspace({
        workspaceRoot: session.layers.overlayRoot,
        game: session.meta.game,
        includeContentHashes: shouldAnalyze || Boolean(semanticCache),
        onProgress: (progress) => options.onProgress?.({
            phase: 'scan',
            current: progress.scannedFiles,
            ...(progress.currentPath ? { message: progress.currentPath } : {})
        })
    }));
    let workspaceIndex = new WorkspaceIndex(workspaceId);
    workspaceIndex.setFiles(scan.files);
    if (scan.files.some((file) => file.resourceKind === 'param' || file.relativePath.toLowerCase().includes('.param'))) {
        workspaceIndex.setParamSemanticState('warming_up');
    }
    if (shouldAnalyze) {
        const analyzed = await measured('workspace.analyze', () => analyzeWorkspace({
            workspaceRoot: session.layers.overlayRoot,
            files: scan.files,
            ...(semanticCache ? { semanticCache } : {}),
            inspectNativeResources: true,
            parseTextResources: true,
            ...(session.layers.baseRoot ? { oodleRuntimeRoot: session.layers.baseRoot } : {}),
            ...(options.onProgress ? { onProgress: options.onProgress } : {})
        }));
        workspaceIndex = analyzed.index;
        const counts = workspaceIndex.getStats();
        const paramUnavailable = scan.files.some(file => file.resourceKind === 'param') && counts.paramRows === 0;
        const analysisDiagnostics = analyzed.diagnostics.slice(0, 32).map(diagnostic => ({
            severity: diagnostic.severity,
            code: diagnostic.code,
            message: diagnostic.message.slice(0, 512),
            ...(diagnostic.sourceUri ? { sourceUri: diagnostic.sourceUri.slice(0, 1024) } : {})
        }));
        emit({ phase: 'workspace.analyze.summary', status: paramUnavailable ? 'failed' : 'complete', details: {
                parsedFiles: analyzed.parsedFiles, inspectedFiles: analyzed.inspectedFiles, counts,
                diagnostics: analysisDiagnostics, diagnosticCount: analyzed.diagnostics.length,
                diagnosticsTruncated: analyzed.diagnostics.length > analysisDiagnostics.length
            } });
        if (paramUnavailable) {
            const cause = analysisDiagnostics[0];
            options.onFallbackWarning?.(`CLI_PARAM_SEMANTICS_UNAVAILABLE: 工作区分析未建立 PARAM 行索引；`
                + (cause ? `${cause.code}: ${cause.message}` : '没有可用语义导出。')
                + ' 此状态不能作为成功分析或任务完成证据；可用的独立原生读取仍保留。');
        }
    }
    else {
        workspaceIndex.rebuildReferences();
        if (workspaceIndex.getStats().paramRows > 0)
            workspaceIndex.setParamSemanticState('ready');
        emit({ phase: 'workspace.index', status: 'complete', details: { analyzed: false } });
    }
    emit({
        phase: 'semantic.cache',
        status: 'complete',
        details: {
            enabled: Boolean(semanticCache),
            hits: semanticCacheHits,
            misses: semanticCacheMisses,
            saves: semanticCacheSaves
        }
    });
    let operationLog;
    let closeOwnedOperationLog;
    let durableLog = true;
    let knowledgeStore = null;
    let knowledgeDatabase = semanticDatabase;
    try {
        const ownedOperationLog = openSqliteOperationLogStore({
            databasePath: join(root, 'workspace.db'),
            workspaceId,
            rootPath: options.overlayRoot,
            game: options.game ?? 'sekiro'
        });
        operationLog = ownedOperationLog;
        closeOwnedOperationLog = () => ownedOperationLog.close();
        emit({ phase: 'storage.audit', status: 'complete', details: { durableLog: true } });
    }
    catch (error) {
        const cause = { code: typeof error?.code === 'string'
                ? error.code : 'SQLITE_DATABASE_OPEN_FAILED',
            message: (error instanceof Error ? error.message : String(error)).slice(0, 1024) };
        emit({ phase: 'storage.audit', status: 'failed', details: { ...cause, durableLog: false } });
        if (options.requireDurableLog === true) {
            throw new Error(`CLI_SQLITE_UNAVAILABLE: 本地审计数据库打不开，写入已失败关闭：${error instanceof Error ? error.message : String(error)}`);
        }
        durableLog = false;
        (options.onFallbackWarning ?? (() => undefined))(`CLI_SQLITE_FALLBACK: ${cause.code}: ${cause.message}；本次只读命令使用内存日志；写入命令将失败关闭。`);
        operationLog = new MemoryOperationLogStore();
    }
    if (durableLog) {
        try {
            if (!knowledgeDatabase)
                knowledgeDatabase = openWorkspaceDatabase(join(root, 'workspace.db'));
            knowledgeStore = new KnowledgeStore({
                persistence: new SqliteKnowledgeStorePersistence(knowledgeDatabase, {
                    workspaceId,
                    rootPath: session.layers.overlayRoot,
                    game: session.meta.game
                }),
                schemaVersion: 'knowledge-v1'
            });
        }
        catch (error) {
            try {
                knowledgeDatabase?.close();
            }
            catch { }
            knowledgeDatabase = null;
            options.onFallbackWarning?.(`KNOWLEDGE_STORE_UNAVAILABLE: 持久知识 store 打不开，本次会话不返回伪造空知识结果：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const mode = options.mode ?? 'normal';
    const coreSession = createAgentCoreToolSession({
        principal: options.principal ?? 'local-cli', workspaceId, workspaceSession: session,
        workspaceIndex, operationLog, modeCeiling: mode,
        storage: { backupBaseDir: join(root, 'backups'), recoveryDir: join(root, 'recovery'), stagingRoot: join(root, 'staging') }
    });
    const editSession = coreSession.requireEditSession();
    const registry = createDefaultToolRegistry();
    const localToolContext = {
        get workspaceIndex() { return coreSession.workspaceIndex; },
        mode,
        modeCeiling: mode,
        allowMemoryWrite: false,
        session,
        operationLogStore: operationLog,
        backupBaseDir: join(root, 'backups'),
        recoveryDir: join(root, 'recovery'),
        coreSession,
        referenceCursorStore: createManagedReferenceCursorStore(root),
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
        onSemanticEvidenceUpdated: async (sourceUris) => {
            if (!semanticCache || !sourceUris?.length)
                return;
            const workspaceIndex = coreSession.workspaceIndex;
            const files = workspaceIndex.getFiles();
            const sources = new Set(sourceUris.map((sourceUri) => (workspaceIndex.getFile(sourceUri)?.sourceUri
                ?? files.find((file) => file.absolutePath === sourceUri)?.sourceUri
                ?? sourceUri)));
            for (const file of files) {
                if (!sources.has(file.sourceUri))
                    continue;
                const bundle = extractFileSymbolBundle(workspaceIndex, file.sourceUri);
                if (isNativeSemanticBundleCurrent(file, bundle))
                    await semanticCache.save(file, bundle);
            }
        },
        ...(knowledgeStore ? { knowledgeStore } : {}),
        ...(!knowledgeStore ? { knowledgeStoreDiagnostic: 'CLI 持久知识数据库不可用。' } : {})
    };
    const rawBridge = createAgentToolBridge({
        registry,
        context: createAgentBridgeBaseContext(mode),
        contextProvider: createAgentToolContextProvider({ coreSession, workspaceSession: session,
            getWorkspaceSession: () => session, getWorkspaceIndex: () => coreSession.workspaceIndex,
            getToolContext: () => localToolContext })
    });
    const mutatingTools = new Set(registry.list().filter(tool => tool.effect === 'write' || tool.effect === 'rollback').map(tool => tool.name));
    const executeTool = async (call, contextOverride = {}) => {
        if (!durableLog && mutatingTools.has(call.name)) {
            return cliToolFailure('CLI_SQLITE_UNAVAILABLE', '本地审计数据库不可用，写入已失败关闭。');
        }
        // SOULFORGE_DEBUG_REF=1: the tool's own marks stop at return, so a wall-clock gap means the
        // seconds are spent inside the bridge pipeline rather than in the handler.
        if (process.env.SOULFORGE_DEBUG_REF === '1') {
            const startedAt = Date.now();
            const result = await rawBridge.executeTool(call, contextOverride);
            console.error(`[cli:timing] ${call.name}=${Date.now() - startedAt}ms`);
            return result;
        }
        if (call.name === 'commit_patch') {
            // The proposal commit needs an approval receipt; in the CLI the explicit --confirm-patch <opId>
            // flag is that approval, bound to the workspace and the single opId it was issued for.
            let patchInput;
            try {
                patchInput = call.argumentsJson.trim() === '' ? {} : JSON.parse(call.argumentsJson);
            }
            catch {
                return rawBridge.executeTool(call, contextOverride);
            }
            const patchOpId = patchInput && typeof patchInput === 'object' && !Array.isArray(patchInput)
                && typeof patchInput.opId === 'string'
                ? patchInput.opId.trim()
                : '';
            if (!patchOpId)
                return rawBridge.executeTool(call, contextOverride);
            const patchAuth = consumeCliPatchAuthorization(patchAuthorization, patchOpId, workspaceId);
            if (!patchAuth.ok)
                return cliToolFailure(patchAuth.code, patchAuth.message);
            return rawBridge.executeTool(call, { ...contextOverride, confirmation: patchAuth.confirmation });
        }
        if (call.name !== 'rollback_operation')
            return rawBridge.executeTool(call, contextOverride);
        let input;
        try {
            input = call.argumentsJson.trim() === '' ? {} : JSON.parse(call.argumentsJson);
        }
        catch {
            return rawBridge.executeTool(call, contextOverride);
        }
        const operationId = input && typeof input === 'object' && !Array.isArray(input)
            && typeof input.opId === 'string'
            ? input.opId.trim()
            : '';
        if (!operationId)
            return rawBridge.executeTool(call, contextOverride);
        const authorization = consumeCliRollbackAuthorization(rollbackAuthorization, operationId, workspaceId);
        if (!authorization.ok)
            return cliToolFailure(authorization.code, authorization.message);
        let record;
        try {
            record = await operationLog.get(operationId);
        }
        catch (error) {
            return cliToolFailure('CLI_ROLLBACK_CONFIRMATION_UNAVAILABLE', `无法核对 rollback operation 所属 workspace：${error instanceof Error ? error.message : String(error)}`);
        }
        if (!record || record.workspaceId !== workspaceId) {
            return cliToolFailure('CLI_ROLLBACK_CONFIRMATION_MISMATCH', 'rollback operation 不存在于当前 workspace，已拒绝使用 CLI 确认凭据。');
        }
        return rawBridge.executeTool(call, { ...contextOverride, confirmation: authorization.confirmation });
    };
    const bridge = { tools: rawBridge.tools, executeTool };
    return {
        coreSession,
        editSession,
        registry,
        bridge,
        executeTool,
        get workspaceIndex() { return coreSession.workspaceIndex; },
        durableLog,
        knowledgeStore,
        dispose: async () => {
            try {
                coreSession.close();
                await disposeBridgeDaemonPool();
            }
            finally {
                try {
                    knowledgeDatabase?.close();
                }
                catch { }
                closeOwnedOperationLog?.();
            }
        }
    };
}
//# sourceMappingURL=localCliSession.js.map