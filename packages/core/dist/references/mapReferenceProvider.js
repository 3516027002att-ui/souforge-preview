const MAX_MAP_REF_DIAGNOSTICS = 500;
/**
 * 受支持的原生外键字段：字段名（Bridge reader 导出的 raw 键）、目标参数表、
 * 关系语义。新增条目必须有 reader 出处，不得从名称反算。
 */
const ENTITY_PARAM_KEYS = Object.freeze([
    { rawField: 'npcParamRowId', table: 'NpcParam', property: 'npcParamId' },
    { rawField: 'thinkParamRowId', table: 'ThinkParam', property: 'thinkParamId' }
]);
/**
 * PARAM 表的比较键。
 *
 * 同一种表在索引里会出现三种写法：目录名 `NpcParam`（规则表）、Sekiro 原生条目名
 * `NPC_PARAM_ST`（export-param / 原生投影）、以及带目录的本机 entryName
 * （`<root>/NpcParam.param`）。只做 `(entryName ?? paramName)` 的字面比较会让外键
 * 永远找不到目标行——那不是「字段缺失」，而是规则与索引命名不同形，连接静默失败。
 * 这里统一到同一个键：取文件名、去 `.param`、只留字母数字、再去掉原生 `_ST` 后缀。
 */
function paramTableKey(name) {
    const base = name.split(/[\\/]/u).pop() ?? name;
    return base
        .replace(/\.param$/iu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/gu, '')
        .replace(/st$/u, '');
}
function indexParamRows(params) {
    const index = new Map();
    for (const paramExport of params) {
        const table = paramTableKey(paramExport.entryName ?? paramExport.paramName);
        for (const row of paramExport.rows) {
            const key = `${table}#${row.rowId}`;
            const target = {
                uri: row.uri,
                sourceUri: row.sourceUri,
                paramName: paramExport.paramName,
                rowId: row.rowId,
                ...(row.rowIndex !== undefined ? { rowIndex: row.rowIndex } : {})
            };
            const list = index.get(key);
            if (list)
                list.push(target);
            else
                index.set(key, [target]);
        }
    }
    return index;
}
function rawField(entity, field) {
    const raw = entity.raw;
    if (typeof raw !== 'object' || raw === null)
        return undefined;
    const value = raw[field];
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}
function entityPositionEvidence(entity) {
    const parts = [`entity ${entity.name}`, `entityId=${entity.entityId ?? '?'}`, `internalEntryId=${entity.internalEntryId ?? '?'}`];
    if (entity.position)
        parts.push(`pos=[${entity.position.join(',')}]`);
    return parts.join(' ');
}
export function buildMapReferenceEdges(maps, params, options = {}) {
    const edges = [];
    const diagnostics = [];
    const stats = {
        confirmed: 0,
        hypotheses: 0,
        ambiguousEntityIds: 0,
        danglingForeignKeys: 0,
        instances: 0
    };
    const pushDiagnostic = (diagnostic) => {
        if (diagnostics.length >= MAX_MAP_REF_DIAGNOSTICS)
            return;
        diagnostics.push(diagnostic);
    };
    const rowsByScopedId = indexParamRows(params);
    for (const mapExport of maps) {
        // entityId 歧义：同一地图内同号实体收集全部实例（步骤 2/3）。
        const byEntityId = new Map();
        for (const entity of mapExport.entities) {
            stats.instances += 1;
            if (typeof entity.entityId === 'number') {
                const list = byEntityId.get(entity.entityId);
                if (list)
                    list.push(entity);
                else
                    byEntityId.set(entity.entityId, [entity]);
            }
        }
        for (const [entityId, instances] of byEntityId) {
            if (instances.length > 1) {
                stats.ambiguousEntityIds += 1;
                pushDiagnostic({
                    severity: 'warning',
                    code: 'MAP_ENTITY_ID_AMBIGUOUS',
                    message: `${mapExport.mapId} 内 entityId=${entityId} 命中 ${instances.length} 个实例（${instances.map((item) => item.name).join(', ')}）；引用不落到单一实例。`,
                    ...(mapExport.entities[0] ? { sourceUri: mapExport.entities[0].sourceUri } : {}),
                    details: { mapId: mapExport.mapId, entityId, candidates: instances.map((item) => item.uri) }
                });
            }
        }
        for (const entity of mapExport.entities) {
            // 原生外键 → PARAM 行（步骤 1）。
            for (const fk of ENTITY_PARAM_KEYS) {
                const rowId = rawField(entity, fk.rawField);
                if (rowId === undefined)
                    continue;
                const key = `${paramTableKey(fk.table)}#${rowId}`;
                const targets = rowsByScopedId.get(key) ?? [];
                if (targets.length === 0) {
                    stats.danglingForeignKeys += 1;
                    pushDiagnostic({
                        severity: 'warning',
                        code: 'MAP_PARAM_FK_TARGET_MISSING',
                        message: `${entity.name} 的原生字段 ${fk.rawField}=${rowId} 指向 ${fk.table}#${rowId}，该表/行不在当前索引；保留外键事实但不生成边。`,
                        sourceUri: entity.sourceUri,
                        details: { entityUri: entity.uri, field: fk.rawField, rowId, table: fk.table }
                    });
                    continue;
                }
                if (targets.length > 1) {
                    stats.danglingForeignKeys += 1;
                    pushDiagnostic({
                        severity: 'warning',
                        code: 'MAP_PARAM_FK_TARGET_AMBIGUOUS',
                        message: `${fk.table}#${rowId} 命中 ${targets.length} 个物理行，外键不落到单一目标。`,
                        sourceUri: entity.sourceUri,
                        details: { entityUri: entity.uri, candidates: targets.map((item) => item.uri) }
                    });
                    continue;
                }
                const target = targets[0];
                const evidence = {
                    sourceUri: entity.sourceUri,
                    fieldName: fk.property,
                    value: rowId,
                    excerpt: `${entityPositionEvidence(entity)} — ${fk.rawField}=${rowId} → ${fk.table}#${rowId}`
                };
                stats.confirmed += 1;
                edges.push({
                    fromUri: entity.uri,
                    toUri: target.uri,
                    kind: 'references_param_row',
                    confidence: 'high',
                    reason: `原生字段 ${entity.name}.${fk.rawField}=${rowId} 声明对 ${fk.table}#${rowId} 的外键。`,
                    evidence: [evidence]
                });
            }
            // 名称前缀假设（步骤 7）：模型名 c1050.tai → chr://c1050，只作定位线索。
            if (options.includeHypotheses && entity.model) {
                const modelMatch = /^(c\d{4,5})\.[a-z]+$/iu.exec(entity.model);
                if (modelMatch) {
                    stats.hypotheses += 1;
                    edges.push({
                        fromUri: entity.uri,
                        toUri: `chr://${modelMatch[1]}`,
                        kind: 'unknown',
                        confidence: 'low',
                        reason: `hypothesis(map.model-prefix): 模型文件名 ${entity.model} 的前缀与角色族号一致；这只说明命名相似，不能证明模型归属或可写性。`,
                        evidence: [{
                                sourceUri: entity.sourceUri,
                                fieldName: 'model',
                                excerpt: entityPositionEvidence(entity)
                            }]
                    });
                }
            }
        }
    }
    if (diagnostics.length >= MAX_MAP_REF_DIAGNOSTICS) {
        diagnostics.push({
            severity: 'warning',
            code: 'MAP_REF_DIAGNOSTICS_TRUNCATED',
            message: `地图引用诊断达到 ${MAX_MAP_REF_DIAGNOSTICS} 条上限，后续缺口未列出。`
        });
    }
    return { edges, diagnostics, stats };
}
//# sourceMappingURL=mapReferenceProvider.js.map