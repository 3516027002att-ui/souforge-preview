const MAX_PARAM_REF_DIAGNOSTICS = 500;
export function buildParamReferenceEdges(params) {
    const edges = [];
    const diagnostics = [];
    const stats = {
        confirmed: 0,
        notApplicable: 0,
        unresolvedConditions: 0,
        rejectedFragments: 0,
        missingTables: 0,
        danglingTargets: 0,
        ambiguousTargets: 0
    };
    const seen = new Set();
    const tableIndex = buildTableIndex(params);
    const rowIndexCache = new Map();
    const pushDiagnostic = (diagnostic) => {
        if (diagnostics.length >= MAX_PARAM_REF_DIAGNOSTICS)
            return;
        diagnostics.push(diagnostic);
    };
    for (const paramExport of params) {
        for (const row of paramExport.rows) {
            for (const field of row.fields ?? []) {
                // 只接受受信任 metadata 发布的目标；未知来源（包括显示名构造）不生成边。
                if (field.refsProvenance !== 'trusted-metadata')
                    continue;
                const targets = field.refs;
                if (!targets || targets.length === 0)
                    continue;
                for (const fragment of field.refsRejected ?? []) {
                    stats.rejectedFragments += 1;
                    pushDiagnostic({
                        severity: 'warning',
                        code: 'PARAM_REF_SYNTAX_REJECTED',
                        message: `${paramExport.paramName}#${row.rowId}.${field.fieldId ?? field.name} 的 Refs 含未识别片段「${fragment}」，该规则的覆盖不完整。`,
                        sourceUri: row.sourceUri,
                        details: { rowUri: row.uri, rowId: row.rowId, fieldId: field.fieldId ?? field.name, rejected: fragment }
                    });
                }
                for (const target of targets) {
                    const outcome = evaluateCondition(row, target.condition);
                    if (outcome === 'unresolved') {
                        stats.unresolvedConditions += 1;
                        pushDiagnostic({
                            severity: 'warning',
                            code: 'PARAM_REF_CONDITION_UNRESOLVED',
                            message: `${paramExport.paramName}#${row.rowId} 缺少条件字段 ${target.condition.fieldId}（或无法解码为整数），引用规则 ${ruleText(target.param, target.condition)} 不适用也无法排除。`,
                            sourceUri: row.sourceUri,
                            details: { rowUri: row.uri, rowId: row.rowId, fieldId: field.fieldId ?? field.name, condition: target.condition }
                        });
                        continue;
                    }
                    if (outcome === 'misses') {
                        stats.notApplicable += 1;
                        continue;
                    }
                    const targetRowId = parseRefRowId(field.value);
                    if (targetRowId === null) {
                        stats.unresolvedConditions += 1;
                        pushDiagnostic({
                            severity: 'warning',
                            code: 'PARAM_REF_VALUE_UNRESOLVED',
                            message: `${paramExport.paramName}#${row.rowId}.${field.fieldId ?? field.name} 的值无法解释为目标行 id（${String(field.value)}），规则 ${ruleText(target.param, target.condition)} 未解析。`,
                            sourceUri: row.sourceUri,
                            details: { rowUri: row.uri, rowId: row.rowId, fieldId: field.fieldId ?? field.name, value: field.value }
                        });
                        continue;
                    }
                    const table = tableIndex.get(target.param.toLowerCase());
                    if (!table) {
                        stats.missingTables += 1;
                        pushDiagnostic({
                            severity: 'warning',
                            code: 'PARAM_REF_TARGET_TABLE_MISSING',
                            message: `规则 ${ruleText(target.param, target.condition)} 指向的表 ${target.param} 不在当前索引中；引用保留为语义事实，但不生成边。`,
                            sourceUri: row.sourceUri,
                            details: { rowUri: row.uri, rowId: row.rowId, targetParam: target.param, targetRowId }
                        });
                        continue;
                    }
                    if (table.exports.length > 1) {
                        stats.ambiguousTargets += 1;
                        pushDiagnostic({
                            severity: 'warning',
                            code: 'PARAM_REF_TARGET_AMBIGUOUS',
                            message: `目标表名 ${target.param} 命中 ${table.exports.length} 个物理 entry（${table.exports.map((item) => `${item.entryIndex ?? '?'}:${item.entryName ?? item.paramName}`).join(', ')}），返回候选而非任选其一。`,
                            sourceUri: row.sourceUri,
                            details: {
                                rowUri: row.uri,
                                rowId: row.rowId,
                                targetParam: target.param,
                                targetRowId,
                                candidates: table.exports.map((item) => ({
                                    sourceUri: item.sourceUri,
                                    entryIndex: item.entryIndex,
                                    entryName: item.entryName
                                }))
                            }
                        });
                        continue;
                    }
                    const ownerExport = table.exports[0];
                    const rows = indexRows(ownerExport, rowIndexCache).byRowId.get(targetRowId) ?? [];
                    if (rows.length === 0) {
                        stats.danglingTargets += 1;
                        pushDiagnostic({
                            severity: 'warning',
                            code: 'PARAM_REF_TARGET_MISSING',
                            message: `悬空引用：${paramExport.paramName}#${row.rowId}.${field.fieldId ?? field.name} 指向 ${table.nativeName}#${targetRowId}，该目标行不存在，不能授权修改不存在的目标。`,
                            sourceUri: row.sourceUri,
                            details: {
                                rowUri: row.uri,
                                rowId: row.rowId,
                                targetParam: table.nativeName,
                                targetRowId,
                                rule: ruleText(target.param, target.condition)
                            }
                        });
                        continue;
                    }
                    if (rows.length > 1) {
                        stats.ambiguousTargets += 1;
                        pushDiagnostic({
                            severity: 'warning',
                            code: 'PARAM_REF_TARGET_AMBIGUOUS',
                            message: `目标 ${table.nativeName}#${targetRowId} 有 ${rows.length} 个物理行（rowIndex ${rows.map((item) => item.rowIndex ?? '?').join('/')}），引用不落到单一目标。`,
                            sourceUri: row.sourceUri,
                            details: {
                                rowUri: row.uri,
                                rowId: row.rowId,
                                targetParam: table.nativeName,
                                targetRowId,
                                candidates: rows.map((item) => ({
                                    rowIndex: item.rowIndex,
                                    dataHash: item.dataHash,
                                    uri: item.uri
                                }))
                            }
                        });
                        continue;
                    }
                    const targetRow = rows[0];
                    if (targetRow.uri === row.uri)
                        continue;
                    const key = `${row.uri}\u0000${targetRow.uri}\u0000${field.fieldId ?? field.name}`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    stats.confirmed += 1;
                    edges.push({
                        fromUri: row.uri,
                        toUri: targetRow.uri,
                        kind: 'references_param_row',
                        confidence: 'high',
                        reason: `受信任 metadata 规则 ${ruleText(target.param, target.condition)} 将 ${paramExport.paramName}#${row.rowId}.${field.fieldId ?? field.name}=${targetRowId} 解析为 ${table.nativeName}#${targetRowId}。`,
                        evidence: [paramRefEvidence(paramExport, row, field, targetRowId, target.param, target.condition)]
                    });
                }
            }
        }
    }
    if (diagnostics.length >= MAX_PARAM_REF_DIAGNOSTICS) {
        diagnostics.push({
            severity: 'warning',
            code: 'PARAM_REF_DIAGNOSTICS_TRUNCATED',
            message: `PARAM 引用诊断达到 ${MAX_PARAM_REF_DIAGNOSTICS} 条上限，后续缺口未列出。`
        });
    }
    return { edges, diagnostics, stats };
}
function evaluateCondition(row, condition) {
    if (!condition)
        return 'holds';
    const sibling = findSiblingField(row, condition.fieldId);
    if (!sibling)
        return 'unresolved';
    const actual = numericValue(sibling.value);
    if (actual === null)
        return 'unresolved';
    return actual === condition.value ? 'holds' : 'misses';
}
function findSiblingField(row, fieldId) {
    const fields = row.fields ?? [];
    const exact = fields.find((field) => field.fieldId === fieldId);
    if (exact)
        return exact;
    const lowered = fieldId.toLowerCase();
    return fields.find((field) => (field.fieldId ?? field.name).toLowerCase() === lowered);
}
/* ------------------------------------------------------------------ */
/* 值与目标解析                                                        */
/* ------------------------------------------------------------------ */
/**
 * 目标 rowId 只接受可精确表示的整数。空槽/sentinel 的解释依赖字段自身的
 * metadata 规则（min/max/enum），符号投影里没有携带这些规则时不得统一
 * 假定 0/-1 无引用 —— 交给 targetStatus 判定（missing → 诊断）。
 */
function parseRefRowId(value) {
    return numericValue(value);
}
function numericValue(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value))
        return value;
    if (typeof value === 'string' && /^\s*-?\d+\s*$/u.test(value)) {
        const parsed = Number.parseInt(value.trim(), 10);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}
function ruleText(param, condition) {
    return condition ? `${param}(${condition.fieldId}=${condition.value})` : param;
}
function paramRefEvidence(paramExport, row, field, targetRowId, targetParam, condition) {
    const rowLabel = `${paramExport.paramName}#${row.rowId}${row.rowIndex === undefined ? '' : `@${row.rowIndex}`}`;
    return {
        sourceUri: row.sourceUri,
        fieldName: field.fieldId ?? field.name,
        value: targetRowId,
        excerpt: `${rowLabel}.${field.fieldId ?? field.name}=${targetRowId} -> ${targetParam}#${targetRowId}`
            + (condition ? ` [${condition.fieldId}=${condition.value}]` : '')
            + ` (rule: ${ruleText(targetParam, condition)})`
    };
}
/* ------------------------------------------------------------------ */
/* 索引                                                                */
/* ------------------------------------------------------------------ */
function buildTableIndex(params) {
    const index = new Map();
    for (const paramExport of params) {
        const nativeName = entryTableName(paramExport);
        const key = nativeName.toLowerCase();
        const existing = index.get(key);
        if (existing) {
            existing.exports.push(paramExport);
        }
        else {
            index.set(key, { nativeName, exports: [paramExport] });
        }
    }
    return index;
}
/** 容器 entry 名是权威表名；paramName（typeName）在不同导出路径下会漂移。 */
function entryTableName(paramExport) {
    const raw = paramExport.entryName ?? paramExport.paramName;
    return raw.split(/[\\/]/u).at(-1).replace(/\.param$/iu, '');
}
function indexRows(paramExport, cache) {
    const cached = cache.get(paramExport);
    if (cached)
        return cached;
    const byRowId = new Map();
    for (const row of paramExport.rows) {
        const list = byRowId.get(row.rowId);
        if (list)
            list.push(row);
        else
            byRowId.set(row.rowId, [row]);
    }
    const built = { byRowId };
    cache.set(paramExport, built);
    return built;
}
//# sourceMappingURL=paramReferenceProvider.js.map