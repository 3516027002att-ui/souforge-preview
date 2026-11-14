import { describeObjectKey } from '../editing/proofIdentities.js';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { createSearchTaeEventsTool } from './tools/search_tae_events.js';
import { createExplainAnimationTool } from './tools/explain_animation.js';
import { createReadTaeEventsTool } from './tools/read_tae_events.js';
import { createAnalyzeTaeStructureTool } from './tools/analyze_tae_structure.js';
import { createInsertTaeEventsTool } from './tools/insert_tae_events.js';
import { createMutateTaeEventTimesTool } from './tools/mutate_tae_event_times.js';
import { createMutateTaeEventFieldsTool } from './tools/mutate_tae_event_fields.js';
import { createReadHksScriptTool } from './tools/read_hks_script.js';
import { createSearchHksScriptTool } from './tools/search_hks_script.js';
import { createWorkspaceStatsTool } from './tools/workspace_stats.js';
import { createRetrieveEvidenceTool } from './tools/retrieve_evidence.js';
import { createResolveEntityTool } from './tools/resolve_entity.js';
import { createSearchResourcesTool } from './tools/search_resources.js';
import { createSearchEventsTool } from './tools/search_events.js';
import { createSearchEventReferenceTool } from './tools/search_event_reference.js';
import { createSearchMapEntitiesTool } from './tools/search_map_entities.js';
import { createSearchParamRowsTool } from './tools/search_param_rows.js';
import { createCompareParamRowsTool } from './tools/compare_param_rows.js';
import { createSearchParamFieldsTool } from './tools/search_param_fields.js';
import { createSearchFieldNamesTool } from './tools/search_field_names.js';
import { createSearchTextEntriesTool } from './tools/search_text_entries.js';
import { createLookupTextIdTool } from './tools/lookup_text_id.js';
import { createFindTextReferencesTool } from './tools/find_text_references.js';
import { createExplainTextEntryTool } from './tools/explain_text_entry.js';
import { createEvaluateEmevdParametersTool } from './tools/evaluate_emevd_parameters.js';
import { createFindReferencesTool } from './tools/find_references.js';
import { createExplainEventTool } from './tools/explain_event.js';
import { createExplainDropChainTool } from './tools/explain_drop_chain.js';
import { createExplainSkillActionsTool } from './tools/explain_skill_actions.js';
import { createIdentifySkillActionTool } from './tools/identify_skill_action.js';
import { createExplainMinibossTool } from './tools/explain_miniboss.js';
import { createProposeTextPatchTool } from './tools/propose_text_patch.js';
import { createProposePlaintextScriptEditTool } from './tools/propose_plaintext_script_edit.js';
import { createValidatePatchTool } from './tools/validate_patch.js';
import { createBuildPatchGraphTool } from './tools/build_patch_graph.js';
import { createAssessEditRiskTool } from './tools/assess_edit_risk.js';
import { createReadParamFieldsTool } from './tools/read_param_fields.js';
import { createMutateParamFieldsTool } from './tools/mutate_param_fields.js';
import { createCreateParamRowTool } from './tools/create_param_row.js';
import { createReadFmgEntriesTool } from './tools/read_fmg_entries.js';
import { createMutateFmgEntriesTool } from './tools/mutate_fmg_entries.js';
import { createReadEmevdEventTool } from './tools/read_emevd_event.js';
import { createReadEmevdOutlineTool } from './tools/read_emevd_outline.js';
import { createApplyEmevdDslTool } from './tools/apply_emevd_dsl.js';
import { createListLuabndScriptsTool } from './tools/list_luabnd_scripts.js';
import { createListContainerEntriesTool } from './tools/list_container_entries.js';
import { createCompareWithBaseTool } from './tools/compare_with_base.js';
import { createReadTpfTool } from './tools/read_tpf.js';
import { createReadFlverTool } from './tools/read_flver.js';
import { createReadGparamTool } from './tools/read_gparam.js';
import { createReadLuabndScriptTool } from './tools/read_luabnd_script.js';
import { createAnalyzeLuabndScriptTool } from './tools/analyze_luabnd_script.js';
import { createMutateLuabndScriptTool } from './tools/mutate_luabnd_script.js';
import { createReadMsbPartsTool } from './tools/read_msb_parts.js';
import { createMutateMsbPartTransformTool } from './tools/mutate_msb_part_transform.js';
import { createQueryMapObjectsTool } from './tools/query_map_objects.js';
import { createInspectMapObjectTool } from './tools/inspect_map_object.js';
import { createBatchTransformMapObjectsTool } from './tools/batch_transform_map_objects.js';
import { createExportMapForBlenderTool } from './tools/export_map_for_blender.js';
import { createImportMapFromBlenderTool } from './tools/import_map_from_blender.js';
import { createCommitPatchTool } from './tools/commit_patch.js';
import { createListOperationsTool } from './tools/list_operations.js';
import { createRollbackOperationTool } from './tools/rollback_operation.js';
import { createReadMemoryTool } from './tools/read_memory.js';
import { createWriteMemoryTool } from './tools/write_memory.js';
import { createListMemoriesTool } from './tools/list_memories.js';
import { createQueryKnowledgeTool } from './tools/query_knowledge.js';
import { createReadKnowledgeClaimsTool } from './tools/read_knowledge_claims.js';
import { createSwitchModeTool } from './tools/switch_mode.js';
import { normalizePermissionLevel, fail, asRecord, resolveHostResolvedEmevdEventTarget } from './toolRegistrySupport.js';
import { parseReadOrigin, rejectWriteOrigin } from './readOrigin.js';
import { decideAiToolPermission, isAiToolPermissionAllowed } from './toolPermissions.js';
import { ProofError } from '../editing/nativeReadProofStore.js';
import { buildSessionWriteRequirements, LegacyFallbackError } from '../editing/writeRequirements.js';
import { readParamChildHashes } from '../param/paramChildHashes.js';
const ENUM_PREFIX = 'enum:';
const ENUM_ARRAY_PREFIX = 'enum[]:';
/** Split a declared type string into its bare type and optionality. */
function parseDeclaredType(declared) {
    const optional = declared.endsWith('?');
    return { bare: optional ? declared.slice(0, -1) : declared, optional };
}
/** Accepted values for the requested enum declaration, or null if absent. */
function enumValues(bare, prefix = ENUM_PREFIX) {
    if (!bare.startsWith(prefix))
        return null;
    const values = bare.slice(prefix.length).split('|').filter((value) => value.length > 0);
    return values.length > 0 ? values : null;
}
export function validateToolInput(shape, input) {
    if (!shape || Object.keys(shape).length === 0)
        return { ok: true };
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, message: '工具输入必须是 JSON 对象。' };
    }
    const record = input;
    const problems = [];
    for (const [key, declared] of Object.entries(shape)) {
        const { bare: expectedType, optional } = parseDeclaredType(declared);
        const value = record[key];
        if (value === undefined) {
            if (!optional)
                problems.push(`缺少必填字段 ${key}`);
            continue;
        }
        const allowed = enumValues(expectedType);
        if (allowed !== null) {
            // Enum values are enforced here rather than silently defaulted in the
            // handler, so a wrong value comes back naming the accepted set.
            if (typeof value !== 'string' || !allowed.includes(value)) {
                problems.push(`字段 ${key} 取值应为 ${allowed.join(' | ')} 之一`);
            }
            continue;
        }
        const allowedItems = enumValues(expectedType, ENUM_ARRAY_PREFIX);
        if (allowedItems !== null) {
            if (!Array.isArray(value)) {
                problems.push(`字段 ${key} 类型应为 array`);
            }
            else {
                value.forEach((item, index) => {
                    if (typeof item !== 'string' || !allowedItems.includes(item)) {
                        problems.push(`字段 ${key}[${index}] 取值应为 ${allowedItems.join(' | ')} 之一`);
                    }
                });
            }
            continue;
        }
        if (expectedType === 'string[]' && Array.isArray(value)) {
            value.forEach((item, index) => {
                if (typeof item !== 'string' || item.trim().length === 0) {
                    problems.push(`字段 ${key}[${index}] 必须是非空字符串，不能传入对象`);
                }
            });
            continue;
        }
        if (!isKnownDeclaredType(expectedType)) {
            problems.push(`字段 ${key} 的声明类型 ${expectedType} 无法校验`);
            continue;
        }
        if (!matchesDeclaredType(value, expectedType)) {
            problems.push(`字段 ${key} 类型应为 ${expectedType}`);
        }
    }
    if (problems.length > 0) {
        return { ok: false, message: `INVALID_INPUT: ${problems.join('；')}。` };
    }
    return { ok: true };
}
/**
 * Project a declared ToolInputShape into the JSON Schema the model sees.
 *
 * This is deliberately a *projection* of the same declaration that
 * validateToolInput enforces at runtime, not a second hand-written schema.
 * Two independent copies would drift silently: the model would be told about
 * fields the validator rejects, or vice versa, and nothing would fail.
 *
 * `additionalProperties` stays true on purpose — validateToolInput ignores
 * undeclared extras (callers attach context markers), so advertising a closed
 * object would misdescribe the runtime contract.
 */
export function toolInputShapeToJsonSchema(shape) {
    const properties = {};
    const required = [];
    for (const [key, declared] of Object.entries(shape ?? {})) {
        const { bare: declaredType, optional } = parseDeclaredType(declared);
        properties[key] = jsonSchemaForDeclaredType(declaredType);
        if (!optional)
            required.push(key);
    }
    return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: true
    };
}
/**
 * Mirror of matchesDeclaredType's accepted type names. Unrecognized names pass
 * validation unchecked there, so they must project to an unconstrained schema
 * here — claiming a type the validator does not enforce would be a lie to the
 * model in the permissive direction.
 */
function jsonSchemaForDeclaredType(declaredType) {
    const allowed = enumValues(declaredType);
    if (allowed !== null)
        return { type: 'string', enum: allowed };
    const allowedItems = enumValues(declaredType, ENUM_ARRAY_PREFIX);
    if (allowedItems !== null)
        return { type: 'array', items: { type: 'string', enum: allowedItems } };
    switch (declaredType) {
        case 'string':
            return { type: 'string' };
        case 'number':
            return { type: 'number' };
        case 'safe-integer':
            return {
                type: 'integer',
                minimum: Number.MIN_SAFE_INTEGER,
                maximum: Number.MAX_SAFE_INTEGER
            };
        case 'boolean':
            return { type: 'boolean' };
        case 'array':
            return { type: 'array' };
        case 'string[]':
            return { type: 'array', items: { type: 'string', pattern: '\\S' } };
        case 'object':
            return { type: 'object' };
        default:
            return {};
    }
}
function matchesDeclaredType(value, expectedType) {
    switch (expectedType) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'safe-integer':
            return typeof value === 'number' && Number.isSafeInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'string[]':
            return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        default:
            // A declared type the validator does not know must not read as "anything goes": a schema
            // typo would silently disable the check for that field.
            return false;
    }
}
const KNOWN_DECLARED_TYPES = new Set([
    'string', 'number', 'safe-integer', 'boolean', 'array', 'string[]', 'object'
]);
/** Exposed so a test can assert every registered schema stays inside the vocabulary. */
export function isKnownDeclaredType(expectedType) {
    return KNOWN_DECLARED_TYPES.has(expectedType);
}
export class ToolRegistry {
    tools = new Map();
    register(tool) {
        if (this.tools.has(tool.name))
            throw new Error(`Tool already registered: ${tool.name}`);
        const permissionLevel = tool.permissionLevel ?? normalizePermissionLevel(tool.permission);
        const effect = permissionLevel === 'rollback' ? 'rollback' : permissionLevel === 'commit' ? 'write' : permissionLevel === 'stage' ? 'stage' : 'read';
        this.tools.set(tool.name, { ...tool, permissionLevel, permission: permissionLevel, effect,
            supportsParallel: (permissionLevel === 'read' || permissionLevel === 'analyze') && tool.supportsParallel !== false,
            proofPolicy: tool.proofPolicy ?? (effect === 'write' ? 'native-read' : 'none') });
    }
    list() {
        return [...this.tools.values()].map(({ name, description, permission, permissionLevel, inputSchema, effect, supportsParallel, proofPolicy }) => ({
            name,
            description,
            permission,
            permissionLevel: permissionLevel ?? normalizePermissionLevel(permission),
            ...(effect ? { effect } : {}),
            ...(proofPolicy ? { proofPolicy } : {}),
            ...(supportsParallel !== undefined ? { supportsParallel } : {}),
            // Surfaced verbatim (not cloned-and-renamed) so the model-facing schema
            // and the runtime validateToolInput check can never disagree: both read
            // this same declaration.
            ...(inputSchema && Object.keys(inputSchema).length > 0 ? { inputSchema } : {})
        }));
    }
    async run(name, input, context) {
        const tool = this.tools.get(name);
        if (!tool)
            return fail('TOOL_NOT_FOUND', `未知工具：${name}。用 list 查看全部工具；名称区分大小写，且必须与 describe 返回的一致。`);
        const level = tool.permissionLevel ?? normalizePermissionLevel(tool.permission);
        const permissionDecision = decideAiToolPermission(level, context.mode);
        if (!permissionDecision.allowed) {
            // 拒绝文案必须只列真能到位的模式。旧文案把 `--mode normal` 说成补救办法，而 `normal`
            // 的最高权限就是 commit —— 被拒的 rollback 在 normal 下永远不会成立，模型照着它重试
            // 就是在一条死路上打转。这里用同一条权限阶梯算出真正可达的模式：switch_mode 只能在
            // 宿主授权上限内下调或持平，所以能靠 switch_mode 解决的和只能靠宿主授权的，要分开说。
            const ceilingMode = context.modeCeiling ?? context.mode;
            const modeRank = { plan: 0, normal: 1, fullPermission: 2 };
            const reachable = ['plan', 'normal', 'fullPermission']
                .filter(mode => isAiToolPermissionAllowed(level, mode));
            const switchable = reachable.filter(mode => modeRank[mode] > modeRank[context.mode]
                && modeRank[mode] <= modeRank[ceilingMode]);
            const remediation = switchable.length > 0
                ? `用 switch_mode 切到 ${switchable.join(' 或 ')}（宿主授权上限 ${ceilingMode} 允许）。`
                : reachable.length > 0
                    ? `当前宿主授权上限 ${ceilingMode} 到不了 ${permissionDecision.required}，switch_mode 无法提升：`
                        + `请用户选择 Bypass 后开始或承接新一轮，或用 --mode ${reachable[0]} 重新启动 CLI。`
                    : '权限阶梯里没有任何模式能达到该级别：这是配置错误，请上报。';
            return fail('TOOL_PERMISSION_DENIED', `工具 '${name}' 需要 ${permissionDecision.required} 权限，当前模式 ${context.mode} 最高只到 ${permissionDecision.ceiling}。`
                + remediation);
        }
        const inputCheck = validateToolInput(tool.inputSchema, input);
        if (!inputCheck.ok) {
            return fail('INVALID_INPUT', inputCheck.message);
        }
        const rawEventInput = asRecord(input);
        // origin 选择「读哪一层」：workspace（默认，当前打开的工作区）或 base（游戏原版）。
        // 写类工具不接受 base —— 未声明的额外键本来会被静默忽略，调用方会以为在写原版，
        // 实际写的是工作区；这个拒绝点覆盖整个注册表，新工具不需要各自记得。
        const writeOriginRefusal = rejectWriteOrigin(name, level, rawEventInput.origin);
        if (writeOriginRefusal)
            return writeOriginRefusal;
        const originParse = parseReadOrigin(rawEventInput.origin);
        if (!originParse.ok)
            return fail(originParse.code, originParse.message);
        const originAware = tool.inputSchema?.origin !== undefined;
        if (originParse.origin === 'base' && !originAware) {
            return fail('BASE_ORIGIN_UNSUPPORTED', `工具 '${name}' 还没有 origin 来源参数，无法保证返回的是原版内容；已拒绝而不是把工作区数据当成原版返回。`
                + '支持原版读取的工具有：read_param_fields、read_emevd_event、read_tae_events、list_container_entries（origin:"base"）；'
                + '要一次看两层的差异请用 compare_with_base。');
        }
        // base 读取是只读对照视图：它不能当写回凭据，也不能让「文件没命中工作区索引」
        // 的告警替它下结论（那条告警会建议用 search_events 重读，而 search_events 只搜工作区）。
        const baseOriginRead = originParse.origin === 'base' && originAware;
        const hasEventIdentity = typeof rawEventInput.file === 'string'
            && rawEventInput.file.trim() !== ''
            && typeof rawEventInput.eventId === 'number'
            && Number.isSafeInteger(rawEventInput.eventId);
        const hostResolvedEmevdEventTarget = hasEventIdentity && !baseOriginRead && (name === 'read_emevd_event'
            || (name === 'apply_emevd_dsl' && rawEventInput.scope === 'event'))
            ? resolveHostResolvedEmevdEventTarget(context, input)
            : undefined;
        if (hostResolvedEmevdEventTarget && !hostResolvedEmevdEventTarget.ok) {
            return fail(hostResolvedEmevdEventTarget.code, hostResolvedEmevdEventTarget.message, hostResolvedEmevdEventTarget.details);
        }
        const resolvedEmevdTarget = hostResolvedEmevdEventTarget?.ok
            ? hostResolvedEmevdEventTarget.target
            : undefined;
        const proofStore = context.nativeReadProofs ?? context.coreSession?.proofStore;
        /** 本次写入会碰到的外层文件：写期间挂起它们的外部变化上报（见 beginOuterWrite）。 */
        const writtenOuterPaths = new Set();
        if (tool.proofPolicy === 'native-read' && proofStore) {
            // T09: requirements are derived from the actual writer payload and the
            // host-resolved native identity. A model-supplied ledger/searchId is
            // never consulted. FMG additions may use the explicitly returned
            // container proof as a narrow, host-defined fallback.
            let requirements;
            try {
                requirements = await buildSessionWriteRequirements(name, input, context.session, resolvedEmevdTarget, (containerPath, tables) => currentParamChildHashes(context, containerPath, tables));
            }
            catch (error) {
                // A text change carries no domain identity to prove a native read against, so the
                // requirement builder falls back. That fallback used to be final: even a proposal the
                // human had just approved (desktop card, or the CLI's one-shot --confirm-patch receipt)
                // was refused, which left commit_patch unable to commit anything at all. An approval
                // receipt is the authorisation the fallback was missing, so honour it and let the Patch
                // Engine's own staging/backup/hash/journal/readback carry the safety.
                if (error instanceof LegacyFallbackError && context.confirmation?.id) {
                    if (process.env.SOULFORGE_DEBUG_PROOF === '1')
                        process.stderr.write(`[proof:gate] tool=${name} legacy-fallback-approved confirmation=${context.confirmation.id}\n`);
                    requirements = [];
                }
                else {
                    const code = error instanceof ProofError || error instanceof LegacyFallbackError
                        ? (error instanceof ProofError ? error.code : 'NATIVE_READ_REQUIREMENT_UNAVAILABLE')
                        : 'NATIVE_READ_REQUIREMENT_UNAVAILABLE';
                    // Without an approval receipt there is no human channel: say that instead of leaving
                    // the caller to interpret an internal fallback message.
                    const message = error instanceof LegacyFallbackError
                        ? `${error.message}（没有人工批准回执：文本提案只用于审阅；Agent 面板批准后可用，CLI 需 --confirm-patch <opId>。要直接改写目标请改用对应域工具，例如 mutate_luabnd_script、mutate_fmg_entries、mutate_param_fields。）`
                        : error instanceof Error ? error.message : String(error);
                    return fail(code, message);
                }
            }
            const principal = context.proofPrincipal ?? context.coreSession?.principal ?? 'session';
            if (process.env.SOULFORGE_DEBUG_PROOF === '1')
                process.stderr.write(`[proof:gate] tool=${name} principal=${principal} ws=${context.workspaceIndex?.workspaceId ?? context.coreSession?.workspaceId ?? ''} reqs=${requirements.map(r => r.objectKey).join(' ; ')}\n`);
            const workspaceId = context.workspaceIndex?.workspaceId ?? context.coreSession?.workspaceId ?? '';
            for (const requirement of requirements) {
                const check = (candidate) => {
                    proofStore.requireCoverage({
                        principal,
                        workspaceId,
                        objectKey: candidate.objectKey,
                        outerSourceKey: candidate.outerSourceKey,
                        version: candidate.version ?? {},
                        ...(candidate.requiredFields ? { requiredFields: candidate.requiredFields } : {}),
                        ...(candidate.requiredShape ? { requiredShape: candidate.requiredShape } : {}),
                        ...(candidate.requiredItemSet === true ? { requiredItemSet: true } : {})
                    });
                };
                try {
                    check(requirement);
                }
                catch (error) {
                    if (requirement.fallback === undefined) {
                        return failProofRequirement(error, requirement);
                    }
                    try {
                        check(requirement.fallback);
                    }
                    catch (fallbackError) {
                        return failProofRequirement(fallbackError, requirement.fallback);
                    }
                }
            }
            // 全部证明通过后才挂起这些文件的外部变化监听：上面的拒绝路径会直接 return，
            // 若在检查途中就挂起，失败的那次写入会永久关闭该容器的外部改动检测。
            for (const requirement of requirements) {
                const outerPath = outerPathFromProofKey(requirement.outerSourceKey);
                if (outerPath !== undefined)
                    writtenOuterPaths.add(outerPath);
            }
            for (const outerPath of writtenOuterPaths)
                context.coreSession?.beginOuterWrite(outerPath);
        }
        try {
            const executionContext = resolvedEmevdTarget
                ? { ...context, hostResolvedEmevdEventTarget: resolvedEmevdTarget }
                : context;
            const result = await tool.run(input, executionContext);
            if (resolvedEmevdTarget) {
                // Keep this host-only and non-enumerable: result.data is the only
                // object that can cross the bounded model-facing projection.
                Object.defineProperty(result, '__hostResolvedEmevdEventTarget', {
                    value: resolvedEmevdTarget,
                    enumerable: false,
                    configurable: true
                });
            }
            if (name === 'read_emevd_event'
                && result.ok
                && !baseOriginRead
                && resolvedEmevdTarget?.canonical !== true
                && result.data
                && typeof result.data === 'object'
                && !Array.isArray(result.data)) {
                const resultData = result.data;
                const diagnostics = Array.isArray(resultData.diagnostics)
                    ? resultData.diagnostics
                    : [];
                const warningCode = 'EMEVD_NONCANONICAL_SOURCE_INSPECT_ONLY';
                const nativeDiagnostics = diagnostics.filter((diagnostic) => (diagnostic
                    && typeof diagnostic === 'object'
                    && !Array.isArray(diagnostic)
                    && diagnostic.code !== warningCode));
                // Keep this diagnostic in the native result data, rather than only
                // in host provenance: projectCompleteNativeEmevdDsl intentionally
                // preserves source diagnostics in the complete model-facing view.
                // Always replace a native same-code item and put the host wording
                // first, so a verbose native list cannot hide or spoof this boundary.
                result.data = {
                    ...resultData,
                    diagnostics: [
                        {
                            severity: 'warning',
                            code: warningCode,
                            message: '当前 file 未直接命中工作区索引的 canonical sourceUri/sourcePath/relativePath/absolutePath；本次 native read 仅供检查，不能生成写回凭据。请使用 search_events 返回的完整 sourceUri 重新读取。'
                        },
                        ...nativeDiagnostics
                    ]
                };
            }
            // base 读取回答的是「原版是什么」，不是「工作区现在是什么」。把这句话放进
            // 结果本身，调用方（和模型）不会把两层的数据混为一条。
            if (baseOriginRead
                && result.ok
                && result.data
                && typeof result.data === 'object'
                && !Array.isArray(result.data)) {
                const resultData = result.data;
                const diagnostics = Array.isArray(resultData.diagnostics) ? resultData.diagnostics : [];
                const baseCode = 'BASE_ORIGIN_READ_ONLY_VIEW';
                if (!diagnostics.some((diagnostic) => diagnostic
                    && typeof diagnostic === 'object'
                    && diagnostic.code === baseCode)) {
                    result.data = {
                        ...resultData,
                        diagnostics: [{
                                severity: 'warning',
                                code: baseCode,
                                message: '本次读取来自游戏原版目录（origin:"base"），不是工作区当前文件；这个视图只读，不产生写回凭据。要修改请用 origin:"workspace" 读取工作区后再写。'
                            }, ...diagnostics]
                    };
                }
            }
            return result;
        }
        catch (error) {
            return fail('TOOL_EXCEPTION', error instanceof Error ? error.message : String(error));
        }
        finally {
            // 无论成功、失败还是抛异常，恢复这些外部文件的变化监听。
            for (const path of writtenOuterPaths)
                context.coreSession?.endOuterWrite(path);
        }
    }
}
export function createDefaultToolRegistry() {
    const registry = new ToolRegistry();
    // T12 step 11: the manual ledger tools read_agent_task_record and
    // update_agent_task_record are removed from the production registry. The
    // automatic native-read proof boundary (T09) replaces the ledger gate; no
    // empty stub is kept to "succeed" for old prompts.
    registry.register(createWorkspaceStatsTool());
    registry.register(createRetrieveEvidenceTool());
    registry.register(createResolveEntityTool());
    registry.register(createSearchResourcesTool());
    registry.register(createSearchEventsTool());
    registry.register(createSearchEventReferenceTool());
    registry.register(createSearchMapEntitiesTool());
    registry.register(createSearchTaeEventsTool());
    registry.register(createSearchParamRowsTool());
    registry.register(createSearchParamFieldsTool());
    registry.register(createSearchFieldNamesTool());
    registry.register(createCompareParamRowsTool());
    registry.register(createSearchTextEntriesTool());
    registry.register(createLookupTextIdTool());
    registry.register(createFindTextReferencesTool());
    registry.register(createExplainTextEntryTool());
    registry.register(createEvaluateEmevdParametersTool());
    registry.register(createFindReferencesTool());
    registry.register(createExplainEventTool());
    registry.register(createExplainDropChainTool());
    registry.register(createExplainSkillActionsTool());
    registry.register(createIdentifySkillActionTool());
    registry.register(createExplainAnimationTool());
    registry.register(createExplainMinibossTool());
    registry.register(createProposeTextPatchTool());
    registry.register(createProposePlaintextScriptEditTool());
    registry.register(createValidatePatchTool());
    registry.register(createBuildPatchGraphTool());
    registry.register(createAssessEditRiskTool());
    registry.register(createReadParamFieldsTool());
    registry.register(createMutateParamFieldsTool());
    registry.register(createCreateParamRowTool());
    registry.register(createReadFmgEntriesTool());
    registry.register(createMutateFmgEntriesTool());
    registry.register(createReadEmevdEventTool());
    registry.register(createReadEmevdOutlineTool());
    registry.register(createApplyEmevdDslTool());
    registry.register(createReadTaeEventsTool());
    registry.register(createAnalyzeTaeStructureTool());
    registry.register(createInsertTaeEventsTool());
    registry.register(createMutateTaeEventTimesTool());
    registry.register(createMutateTaeEventFieldsTool());
    registry.register(createReadHksScriptTool());
    registry.register(createSearchHksScriptTool());
    registry.register(createListLuabndScriptsTool());
    registry.register(createListContainerEntriesTool());
    registry.register(createCompareWithBaseTool());
    registry.register(createReadTpfTool());
    registry.register(createReadFlverTool());
    registry.register(createReadGparamTool());
    registry.register(createReadLuabndScriptTool());
    registry.register(createAnalyzeLuabndScriptTool());
    registry.register(createMutateLuabndScriptTool());
    registry.register(createReadMsbPartsTool());
    registry.register(createMutateMsbPartTransformTool());
    registry.register(createQueryMapObjectsTool());
    registry.register(createInspectMapObjectTool());
    registry.register(createBatchTransformMapObjectsTool());
    registry.register(createExportMapForBlenderTool());
    registry.register(createImportMapFromBlenderTool());
    registry.register(createCommitPatchTool());
    registry.register(createListOperationsTool());
    registry.register(createRollbackOperationTool());
    registry.register(createReadMemoryTool());
    registry.register(createWriteMemoryTool());
    registry.register(createListMemoriesTool());
    registry.register(createQueryKnowledgeTool());
    registry.register(createReadKnowledgeClaimsTool());
    registry.register(createSwitchModeTool());
    return registry;
}
export { finalizeCommittedToolResult, finalizeEmevdDslApplyResult, summarizeReferences, resolveRagCorpus, ENUM_FIELD_NORMALIZERS } from './toolRegistrySupport.js';
/** Which read tool delivers the object a refused write needs; keeps the failure actionable. */
function readToolForObjectKey(objectKey) {
    const prefix = objectKey.slice(0, objectKey.indexOf('|'));
    switch (prefix) {
        case 'param':
        case 'param-table': return 'read_param_fields';
        case 'emevd': return 'read_emevd_event';
        case 'emevd-file': return 'read_emevd_outline';
        case 'fmg':
        case 'fmg-container': return 'read_fmg_entries';
        case 'msb': return 'read_msb_parts';
        case 'tae': return 'read_tae_events';
        case 'script': return 'read_luabnd_script';
        default: return undefined;
    }
}
/**
 * 门禁用的「目标 PARAM 子表现在的内容哈希」。
 *
 * 只有它能让写入自证「我读的那张表一个字节都没变」：同容器里另一张表被写过时，
 * 本表的读证明不再被一刀切作废。解析不出（无原生编辑会话 / Bridge 读失败 / 子项压缩存储）
 * 时返回 undefined，写入退回失败关闭语义。
 *
 * 传入的是「这次要写的表 + 行」而不是只有表名：`BEHAVIOR_PARAM_ST` 这类原生类型名
 * 对应多张物理子表，锚点必须按实际那张子表取哈希（见 readParamChildHashes）。
 */
async function currentParamChildHashes(context, containerPath, targets) {
    const editSession = context.editSession && context.editSession.session === context.session
        ? context.editSession
        : context.coreSession?.editSession;
    if (!editSession)
        return targets.map(() => undefined);
    if (context.session !== undefined && editSession.session !== context.session)
        return targets.map(() => undefined);
    if (process.env.SOULFORGE_DEBUG_PROOF === '1') {
        process.stderr.write(`[proof:param-hash] container=${containerPath} targets=${targets.map((target) => `${target.table}#${target.rowIds.join(',')}`).join(';')}\n`);
    }
    return readParamChildHashes({ edit: editSession, containerPath, targets });
}
/**
 * 证明键里的外层源 → 可监听的本机绝对路径。
 * PARAM/TAE 等域用 file URL 作外层键；非 file 键（合成 fixture、workspace://）返回 undefined。
 */
function outerPathFromProofKey(outerSourceKey) {
    if (!outerSourceKey.startsWith('file:'))
        return undefined;
    try {
        const path = fileURLToPath(outerSourceKey);
        return isAbsolute(path) ? path : undefined;
    }
    catch {
        return undefined;
    }
}
/** Fail closed, but say which read unblocks the write and for which fields. */
function failProofRequirement(error, requirement) {
    const code = error instanceof ProofError ? error.code : 'NATIVE_READ_REQUIRED';
    const message = error instanceof Error ? error.message : String(error);
    const readTool = readToolForObjectKey(requirement.objectKey);
    const details = {
        objectKey: describeObjectKey(requirement.objectKey),
        ...(process.env.SOULFORGE_DEBUG_PROOF === '1' ? { rawObjectKey: requirement.objectKey, rawOuterSourceKey: requirement.outerSourceKey } : {}),
        ...(requirement.requiredFields && requirement.requiredFields.length > 0 ? { requiredFields: [...requirement.requiredFields] } : {}),
        ...(readTool === undefined ? {} : { readTool }),
        ...(requirement.objectKey.startsWith('tae|')
            ? {
                proofRole: /^tae\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|action$/u.test(requirement.objectKey) ? 'target-action' : 'template-event',
                orderingHint: 'insert_tae_events 需要两份证明：先 read_tae_events(目标动作的 addresses)，再 read_tae_events(模板所在动作/事件)，然后立刻 insert_tae_events；'
                    + '同一容器任何一次写入都会作废此前读到的证明，所以每次插入都要按这个顺序重读。'
            }
            : {})
    };
    const argumentHint = requirement.objectKey.startsWith('tae|')
        ? '，addresses 需指定动作地址（如 action://c0000/tae/3/A320030）'
        : '';
    const setShaped = requirement.objectKey.startsWith('param-table|')
        || requirement.objectKey.startsWith('fmg-container|')
        || requirement.objectKey.startsWith('emevd-file|');
    const hint = readTool === undefined || setShaped
        ? ''
        : `；先调用 ${readTool} 读取该目标后重试${argumentHint}`;
    // "Read it first" is a dead end when the target itself does not exist: the read fails too and the
    // caller learns nothing. For PARAM and FMG, say how to confirm the table (and row/id) first.
    // An EMEVD event that does not exist can never be read, so name the create path instead of
    // sending the caller back to a read that must fail.
    const targetHint = requirement.objectKey.startsWith('param|')
        ? '；如果表名或 rowId 本身不存在，读取也会失败——先用 search_param_rows 确认目标'
        : requirement.objectKey.startsWith('param-table|')
            ? '；新建行前先用 read_param_fields { allRows: true } 从 rowOffset=0 按 hasMore/nextOffset 翻到 hasMore=false（同一 session 里，页会累积），把整张表的行集合读完再写'
            : requirement.objectKey.startsWith('fmg-container|') || requirement.objectKey.startsWith('fmg|')
                ? '；新增条目前先用 read_fmg_entries { allEntries: true } 从 offset=0 按 hasMore/nextOffset 翻到 hasMore=false（同一 session 里，页会累积）；只读一页条目不能授权新增。如果表名或条目 id 本身不存在，读取也会失败——FMG 表名可能是本地化名（如 アイテム名）'
                : requirement.objectKey.startsWith('emevd|')
                    ? '；如果这个 eventId 本来就不存在（要新建事件），read_emevd_event 必然失败：改用 apply_emevd_dsl {scope:"event", eventId, createIfMissing:true}，并用 read_emevd_outline 的事件集回执授权'
                    : requirement.objectKey.startsWith('emevd-file|')
                        ? '；新建事件前先用 read_emevd_outline 从 offset=0 按 hasMore/nextOffset 翻到 hasMore=false（同一 session 里，页会累积），再把回执里的 sourceHash/outerFileHash/sourceRevision 原样传回'
                        : '';
    // A coverage refusal already names the exact pages that are missing and how to resume; the
    // EMEVD session boundary message already says which session must read and how to page. Appending
    // "先调用 read_emevd_outline 读取该目标后重试" on top repeats the same instruction twice.
    const selfContained = error instanceof ProofError && /hasMore=false/u.test(message);
    const suffix = hint + targetHint;
    return fail(code, selfContained || suffix === ''
        ? message
        // The message already ends with a full stop; joining it to "；先调用…" produced "。；".
        : `${message.replace(/。$/u, '')}${suffix}。`, details);
}
//# sourceMappingURL=toolRegistry.js.map