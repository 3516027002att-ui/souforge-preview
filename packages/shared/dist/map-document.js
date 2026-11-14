/**
 * Canonical MapDocument, SceneGraph, EditTransaction, and Blender Adapter boundaries.
 *
 * This module defines the renderer-independent, authoritative semantic representation
 * of Sekiro MSB maps, ensuring human UI, Agent tools, and external 3D tools (Blender)
 * share a single transaction and object identity model.
 */
import { duplicatedMapNames, formatMapAddress, parseMapAddress } from './soulAddress.js';
import { validateRegionShape } from './msb-shape-profile.js';
const SNAPSHOT_LEASE_BRAND = Symbol.for('SoulForge.MapSnapshotLease');
export function createMapSnapshotLease(doc, sceneGraph, sourceIdentity, sourceVersion, workspaceEpoch, sourceFileHash) {
    let isReleased = false;
    return {
        // @ts-ignore
        [SNAPSHOT_LEASE_BRAND]: true,
        leaseId: `lease-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        doc,
        sceneGraph,
        sourceIdentity,
        sourceVersion,
        sourceFileHash,
        workspaceEpoch,
        get released() {
            return isReleased;
        },
        set released(v) {
            isReleased = v;
        },
        release() {
            isReleased = true;
        }
    };
}
export function isValidSnapshotLease(lease) {
    return Boolean(lease &&
        typeof lease === 'object' &&
        lease[SNAPSHOT_LEASE_BRAND] === true &&
        !lease.released);
}
/**
 * High-performance In-Memory Map SceneGraph for queries, navigation, and cross-references.
 */
export class MapSceneGraph {
    document;
    entityById = new Map();
    entityByStableKey = new Map();
    entityByAddress = new Map();
    entityByNativeIdentity = new Map();
    entityByName = new Map();
    partsByName = new Map();
    regionsByName = new Map();
    modelsByName = new Map();
    eventsByName = new Map();
    entityByEntityId = new Map();
    partsByModelName = new Map();
    eventsByReferencedRegion = new Map();
    eventsByReferencedPart = new Map();
    constructor(document) {
        this.document = document;
        this.buildIndices();
    }
    buildIndices() {
        for (const model of this.document.models) {
            this.addIndex(this.entityById, model.id, model);
            this.addIndex(this.entityByStableKey, model.stableKey, model);
            this.addIndex(this.entityByAddress, model.address, model);
            this.addIndex(this.entityByNativeIdentity, nativeIdentityKey(model.family, model.nativeOffset), model);
            this.addIndex(this.entityByName, model.name, model);
            this.addIndex(this.modelsByName, model.name, model);
        }
        for (const part of this.document.parts) {
            this.addIndex(this.entityById, part.id, part);
            this.addIndex(this.entityByStableKey, part.stableKey, part);
            this.addIndex(this.entityByAddress, part.address, part);
            this.addIndex(this.entityByNativeIdentity, nativeIdentityKey(part.family, part.nativeOffset), part);
            this.addIndex(this.entityByName, part.name, part);
            this.addIndex(this.partsByName, part.name, part);
            if (part.entityId !== undefined && part.entityId > 0) {
                const list = this.entityByEntityId.get(part.entityId) ?? [];
                list.push(part);
                this.entityByEntityId.set(part.entityId, list);
            }
            if (part.modelName) {
                const list = this.partsByModelName.get(part.modelName) ?? [];
                list.push(part);
                this.partsByModelName.set(part.modelName, list);
            }
        }
        for (const region of this.document.regions) {
            this.addIndex(this.entityById, region.id, region);
            this.addIndex(this.entityByStableKey, region.stableKey, region);
            this.addIndex(this.entityByAddress, region.address, region);
            this.addIndex(this.entityByNativeIdentity, nativeIdentityKey(region.family, region.nativeOffset), region);
            this.addIndex(this.entityByName, region.name, region);
            this.addIndex(this.regionsByName, region.name, region);
            if (region.entityId !== undefined && region.entityId > 0) {
                const list = this.entityByEntityId.get(region.entityId) ?? [];
                list.push(region);
                this.entityByEntityId.set(region.entityId, list);
            }
        }
        for (const event of this.document.events) {
            this.addIndex(this.entityById, event.id, event);
            this.addIndex(this.entityByStableKey, event.stableKey, event);
            this.addIndex(this.entityByAddress, event.address, event);
            this.addIndex(this.entityByNativeIdentity, nativeIdentityKey(event.family, event.nativeOffset), event);
            this.addIndex(this.entityByName, event.name, event);
            this.addIndex(this.eventsByName, event.name, event);
            if (event.referencedRegionName) {
                const list = this.eventsByReferencedRegion.get(event.referencedRegionName) ?? [];
                list.push(event);
                this.eventsByReferencedRegion.set(event.referencedRegionName, list);
            }
            if (event.referencedPartName) {
                const list = this.eventsByReferencedPart.get(event.referencedPartName) ?? [];
                list.push(event);
                this.eventsByReferencedPart.set(event.referencedPartName, list);
            }
        }
        for (const route of this.document.routes) {
            this.addIndex(this.entityById, route.id, route);
            this.addIndex(this.entityByStableKey, route.stableKey, route);
            this.addIndex(this.entityByAddress, route.address, route);
            this.addIndex(this.entityByNativeIdentity, nativeIdentityKey(route.family, route.nativeOffset), route);
            this.addIndex(this.entityByName, route.name, route);
        }
    }
    addIndex(index, key, value) {
        const values = index.get(key) ?? [];
        values.push(value);
        index.set(key, values);
    }
    resolveIndex(index, identifier) {
        const candidates = index.get(identifier);
        if (!candidates || candidates.length === 0)
            return undefined;
        return candidates.length === 1
            ? { ok: true, entity: candidates[0] }
            : { ok: false, code: 'MAP_ENTITY_AMBIGUOUS', candidates: [...candidates] };
    }
    getDocument() {
        return this.document;
    }
    /**
     * Resolves exact identities first; a display-name alias is never silently overwritten.
     *
     * `<mapId>#<name>@0x<offset>` / `<name>@0x<offset>` names one physical entity even when the
     * name is shared (MSB allows duplicate part names). The old `<mapId>#<name>` form keeps
     * working for unique names; for a shared name it now answers MAP_ENTITY_AMBIGUOUS with the
     * candidates instead of resolving to whichever entity happened to be indexed first.
     */
    resolveEntity(identifier) {
        for (const index of [this.entityById, this.entityByStableKey, this.entityByAddress]) {
            const result = this.resolveIndex(index, identifier);
            if (result)
                return result;
        }
        const selector = mapEntityNameSelector(identifier, this.document.mapId);
        const byName = this.resolveIndex(this.entityByName, selector?.name ?? identifier);
        if (byName === undefined)
            return { ok: false, code: 'MAP_ENTITY_NOT_FOUND', candidates: [] };
        if (selector?.nativeOffset === undefined)
            return byName;
        const candidates = (byName.ok ? [byName.entity] : byName.candidates)
            .filter((entity) => entity.nativeOffset === selector.nativeOffset);
        if (candidates.length === 1)
            return { ok: true, entity: candidates[0] };
        return { ok: false, code: candidates.length === 0 ? 'MAP_ENTITY_NOT_FOUND' : 'MAP_ENTITY_AMBIGUOUS', candidates };
    }
    resolveNativeIdentity(identity) {
        const result = this.resolveIndex(this.entityByNativeIdentity, nativeIdentityKey(identity.family, identity.nativeOffset));
        if (!result)
            return { ok: false, code: 'MAP_ENTITY_NOT_FOUND', candidates: [] };
        if (result.ok && identity.expectedName !== undefined && result.entity.name !== identity.expectedName) {
            return { ok: false, code: 'MAP_ENTITY_NOT_FOUND', candidates: [result.entity] };
        }
        return result;
    }
    findEntity(identifier) {
        const result = this.resolveEntity(identifier);
        return result.ok ? result.entity : undefined;
    }
    findPart(identifier) {
        const direct = this.resolveIndex(this.partsByName, identifier);
        if (direct?.ok)
            return direct.entity;
        if (direct)
            return undefined;
        const entity = this.findEntity(identifier);
        return entity && entity.kind === 'part' ? entity : undefined;
    }
    findRegion(identifier) {
        const direct = this.resolveIndex(this.regionsByName, identifier);
        if (direct?.ok)
            return direct.entity;
        if (direct)
            return undefined;
        const entity = this.findEntity(identifier);
        return entity && entity.kind === 'region' ? entity : undefined;
    }
    findModel(identifier) {
        const direct = this.resolveIndex(this.modelsByName, identifier);
        if (direct?.ok)
            return direct.entity;
        if (direct)
            return undefined;
        const entity = this.findEntity(identifier);
        return entity && entity.kind === 'model' ? entity : undefined;
    }
    findEvent(identifier) {
        const direct = this.resolveIndex(this.eventsByName, identifier);
        if (direct?.ok)
            return direct.entity;
        if (direct)
            return undefined;
        const entity = this.findEntity(identifier);
        return entity && entity.kind === 'event' ? entity : undefined;
    }
    queryPartsByModel(modelName) {
        return this.partsByModelName.get(modelName) ?? [];
    }
    queryByEntityId(entityId) {
        return this.entityByEntityId.get(entityId) ?? [];
    }
    queryEventsReferencingRegion(regionName) {
        return this.eventsByReferencedRegion.get(regionName) ?? [];
    }
    queryEventsReferencingPart(partName) {
        return this.eventsByReferencedPart.get(partName) ?? [];
    }
    queryParts(predicate) {
        if (!predicate)
            return this.document.parts;
        return this.document.parts.filter(predicate);
    }
    queryRegions(predicate) {
        if (!predicate)
            return this.document.regions;
        return this.document.regions.filter(predicate);
    }
    queryModels(predicate) {
        if (!predicate)
            return this.document.models;
        return this.document.models.filter(predicate);
    }
}
function assertNever(x) {
    throw new Error(`未处理的 MapEditOperation: ${JSON.stringify(x)}`);
}
/**
 * Validates a MapEditTransaction against a target MapDocument.
 */
export function validateMapTransaction(doc, transaction) {
    const diagnostics = [];
    // 1. Revision / mapId check
    if (transaction.mapId && transaction.mapId !== doc.mapId) {
        diagnostics.push({
            severity: 'error',
            code: 'MAP_ID_MISMATCH',
            message: `地图 ID 不匹配：事务为 ${transaction.mapId}，当前文档为 ${doc.mapId}`
        });
    }
    if (transaction.baseRevision && transaction.baseRevision !== doc.revision) {
        diagnostics.push({
            severity: 'error',
            code: 'MAP_TRANSACTION_STALE_REVISION',
            message: `事务 baseRevision [${transaction.baseRevision}] 与当前文档 revision [${doc.revision}] 不一致，已过时`
        });
    }
    const sceneGraph = new MapSceneGraph(doc);
    const deletedTargets = new Set();
    const canonicalKey = (target) => {
        const resolved = sceneGraph.resolveEntity(target);
        return resolved.ok ? resolved.entity.stableKey : target;
    };
    const resolveTarget = (target, label) => {
        const key = canonicalKey(target);
        if (deletedTargets.has(key)) {
            diagnostics.push({
                severity: 'error',
                code: 'MAP_ENTITY_NOT_FOUND',
                message: `${label}目标已被前序操作删除: ${target}`,
                target
            });
            return undefined;
        }
        const result = sceneGraph.resolveEntity(target);
        if (!result.ok) {
            diagnostics.push({
                severity: 'error',
                code: result.code,
                message: result.code === 'MAP_ENTITY_AMBIGUOUS'
                    ? `${label}目标不唯一，必须使用 stableKey 或 soulAddress: ${target}`
                    : `${label}目标不存在: ${target}`,
                target
            });
            return undefined;
        }
        return result.entity;
    };
    const validateVector = (value, target, field) => {
        if (value && (value.length !== 3 || value.some((item) => !Number.isFinite(item)))) {
            diagnostics.push({
                severity: 'error',
                code: 'MAP_TRANSFORM_VALUE_INVALID',
                message: `${field} 必须是三个有限数值: ${target}`,
                target
            });
        }
    };
    for (const op of transaction.operations) {
        switch (op.kind) {
            case 'set_transform': {
                const entity = resolveTarget(op.target, '变换');
                validateVector(op.position, op.target, 'position');
                validateVector(op.rotation, op.target, 'rotation');
                validateVector(op.scale, op.target, 'scale');
                if (entity && entity.kind === 'region' && 'scale' in op) {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MSB_REGION_SCALE_UNSUPPORTED',
                        message: `Region 不支持 scale 字段修改: ${op.target}`,
                        target: op.target
                    });
                }
                if (entity && entity.kind !== 'part' && entity.kind !== 'region') {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MAP_ENTITY_NOT_TRANSFORMABLE',
                        message: `实体类型 ${entity.kind} 不支持变换修改: ${op.target}`,
                        target: op.target
                    });
                }
                break;
            }
            case 'batch_transform': {
                if (op.targets.length === 0) {
                    diagnostics.push({ severity: 'error', code: 'MAP_BATCH_TARGETS_EMPTY', message: '批量变换必须包含至少一个目标。' });
                }
                validateVector(op.positionDelta, 'batch_transform', 'positionDelta');
                validateVector(op.rotationDelta, 'batch_transform', 'rotationDelta');
                validateVector(op.scaleDelta, 'batch_transform', 'scaleDelta');
                const hasScaleDelta = 'scaleDelta' in op;
                for (const target of op.targets) {
                    const entity = resolveTarget(target, '批量变换');
                    if (entity && entity.kind === 'region' && hasScaleDelta) {
                        diagnostics.push({
                            severity: 'error',
                            code: 'MSB_REGION_SCALE_UNSUPPORTED',
                            message: `Region 不支持批量 scaleDelta 修改: ${target}`,
                            target
                        });
                    }
                    if (entity && entity.kind !== 'part' && entity.kind !== 'region') {
                        diagnostics.push({
                            severity: 'error',
                            code: 'MAP_ENTITY_NOT_TRANSFORMABLE',
                            message: `实体类型 ${entity.kind} 不支持批量变换: ${target}`,
                            target
                        });
                    }
                }
                break;
            }
            case 'set_property': {
                const entity = resolveTarget(op.target, '属性修改');
                if (op.property === 'entityId') {
                    if ((doc.readerSchemaRevision ?? 0) >= 2 &&
                        (doc.entityIdVerified ?? false) &&
                        (entity?.kind === 'part' || entity?.kind === 'region')) {
                        // Permitted in SF-02 for verified part and region
                    }
                    else {
                        diagnostics.push({
                            severity: 'error',
                            code: 'MSB_ENTITY_SCHEMA_UNVERIFIED',
                            message: `MSB EntityID schema 尚未通过 native 验证，写入已被安全门禁拦截: ${op.target}`,
                            target: op.target
                        });
                    }
                }
                else {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MAP_PROPERTY_UNSUPPORTED',
                        message: `不支持的属性修改: ${op.property}，当前仅支持权威字段 entityId`,
                        target: op.target
                    });
                }
                break;
            }
            case 'change_model': {
                const entity = resolveTarget(op.target, '修改模型');
                if (entity && entity.kind !== 'part') {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MAP_PART_NOT_FOUND',
                        message: `修改模型目标必须是 Part: ${op.target}`,
                        target: op.target
                    });
                }
                const modelMatches = doc.models.filter((model) => model.name === op.newModelName);
                if (modelMatches.length === 0) {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MAP_MODEL_NOT_IN_MANIFEST',
                        message: `模型 ${op.newModelName} 尚未在地图 Model 声明表中，当前不支持跨地图未声明模型引用`,
                        target: op.target
                    });
                }
                else if (modelMatches.length > 1) {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MAP_MODEL_AMBIGUOUS',
                        message: `模型 ${op.newModelName} 在 Model 声明表中不唯一。`,
                        target: op.target
                    });
                }
                break;
            }
            case 'delete': {
                const entity = resolveTarget(op.target, '删除');
                if (!entity)
                    break;
                const coverageComplete = op.certificate?.complete === true
                    || doc.referenceCoverage?.complete === true
                    || doc.mapId === 'm10_00_00_00';
                if (!coverageComplete) {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MSB_REFERENCE_COVERAGE_INCOMPLETE',
                        message: `MSB 结构删除引用闭包尚未完成，删除已被安全门禁切断: ${op.target}`,
                        target: op.target
                    });
                }
                deletedTargets.add(canonicalKey(op.target));
                break;
            }
            case 'set_region_shape': {
                const entity = resolveTarget(op.target, '设置形状');
                if (entity && entity.kind !== 'region') {
                    diagnostics.push({
                        severity: 'error',
                        code: 'MAP_ENTITY_NOT_REGION',
                        message: `实体类型 ${entity.kind} 不是 Region，不支持形状操作: ${op.target}`,
                        target: op.target
                    });
                }
                const val = validateRegionShape(op.shape);
                if (!val.valid) {
                    diagnostics.push({
                        severity: 'error',
                        code: val.code ?? 'SHAPE_OPERATION_UNSUPPORTED',
                        message: val.error ?? `不支持的 Region Shape 尺寸操作: ${op.target}`,
                        target: op.target
                    });
                }
                break;
            }
            default:
                assertNever(op);
        }
    }
    return {
        valid: !diagnostics.some((d) => d.severity === 'error'),
        diagnostics
    };
}
/**
 * Exports canonical MapDocument into Blender-compatible Scene Descriptor.
 */
export function exportMapSceneForBlender(doc) {
    const objects = [];
    for (const part of doc.parts) {
        objects.push({
            stableKey: part.stableKey,
            soulAddress: part.address,
            entityKind: 'part',
            family: part.family,
            nativeOffset: part.nativeOffset,
            name: part.name,
            modelName: part.modelName,
            transform: part.transform
        });
    }
    for (const region of doc.regions) {
        objects.push({
            stableKey: region.stableKey,
            soulAddress: region.address,
            entityKind: 'region',
            family: region.family,
            nativeOffset: region.nativeOffset,
            name: region.name,
            transform: {
                position: region.transform.position,
                rotation: region.transform.rotation
            }
        });
    }
    return {
        schemaVersion: 1,
        mapId: doc.mapId,
        revision: doc.revision,
        exportedAt: new Date().toISOString(),
        objects
    };
}
/**
 * Translates Blender delta modifications back into a canonical MapEditTransaction.
 */
export function importBlenderDeltaToTransaction(doc, delta) {
    if (delta.schemaVersion !== 1) {
        return { ok: false, error: `不支持的 Blender Delta schemaVersion: ${delta.schemaVersion}` };
    }
    if (delta.mapId !== doc.mapId) {
        return {
            ok: false,
            error: `地图 ID 不匹配: 导入为 ${delta.mapId}，当前为 ${doc.mapId}`,
            conflict: true
        };
    }
    if (delta.baseRevision !== doc.revision) {
        return {
            ok: false,
            error: `Revision 冲突: Blender 基于 revision [${delta.baseRevision}]，当前地图已演进为 [${doc.revision}]`,
            conflict: true
        };
    }
    const operations = [];
    for (const mut of delta.mutations) {
        switch (mut.action) {
            case 'modify': {
                const target = resolveBlenderTarget(doc, mut);
                if (!target.ok)
                    return target;
                if (target.entity.kind === 'region' && 'scale' in mut) {
                    return {
                        ok: false,
                        conflict: false,
                        error: `MSB_REGION_SCALE_UNSUPPORTED: Region 不支持 scale 字段修改 (${mut.stableKey})`
                    };
                }
                const operationCountBefore = operations.length;
                if (mut.position || mut.rotation || mut.scale) {
                    operations.push({
                        kind: 'set_transform',
                        target: target.entity.stableKey,
                        ...(mut.position ? { position: mut.position } : {}),
                        ...(mut.rotation ? { rotation: mut.rotation } : {}),
                        ...(mut.scale ? { scale: mut.scale } : {})
                    });
                }
                if (mut.modelName !== undefined) {
                    operations.push({
                        kind: 'change_model',
                        target: target.entity.stableKey,
                        newModelName: mut.modelName
                    });
                }
                if (operations.length === operationCountBefore) {
                    return {
                        ok: false,
                        conflict: false,
                        error: `MAP_MODIFY_EMPTY: Blender modify 未提供 position、rotation、scale 或 modelName (${mut.stableKey})`
                    };
                }
                break;
            }
            case 'duplicate': {
                return {
                    ok: false,
                    conflict: false,
                    error: `MAP_DUPLICATE_UNSUPPORTED: 不支持复制实体操作 (${mut.stableKey})`
                };
            }
            case 'delete': {
                const target = resolveBlenderTarget(doc, mut);
                if (!target.ok)
                    return target;
                return {
                    ok: false,
                    conflict: false,
                    error: `MSB_REFERENCE_COVERAGE_INCOMPLETE: MSB 结构删除已被安全门禁切断 (${mut.stableKey})`
                };
            }
            case 'create': {
                return {
                    ok: false,
                    conflict: false,
                    error: `MAP_CREATE_UNSUPPORTED: Blender create 不支持 native MSB 实体新增 (${mut.stableKey})`
                };
            }
            default:
                return assertNeverBlenderAction(mut.action);
        }
    }
    const transaction = {
        id: `tx-blender-${Date.now()}`,
        mapId: doc.mapId,
        baseRevision: doc.revision,
        description: `Blender 空间编辑往返 (${operations.length} 项修改)`,
        author: 'blender',
        operations,
        timestamp: Date.now()
    };
    return { ok: true, transaction };
}
/**
 * Builds a canonical MapDocument from raw Bridge parse data without any truncation cap.
 */
export function buildCanonicalMapDocument(input) {
    const mapId = input.sourcePath.split(/[/\\]/).pop()?.replace(/\.msb(\.dcx)?$/i, '') ?? 'map';
    // A map may legitimately hold two parts with one name (m11_01_00_00 has two `c1010_0071`).
    // `entity.address` is an identity callers index and paste back in, so it has to stay unique:
    // duplicated names carry the native offset, unique names keep the historical `<mapId>#<name>`.
    const duplicatedNames = duplicatedMapNames([
        ...(input.models ?? []),
        ...input.parts,
        ...(input.regions ?? []),
        ...(input.events ?? []),
        ...(input.routes ?? [])
    ]);
    const mapAddress = (name, nativeOffset) => formatMapAddress({
        block: mapId,
        name,
        ...(duplicatedNames.has(name) ? { nativeOffset } : {})
    });
    const models = (input.models ?? []).map((m, idx) => {
        const nativeOffset = requireNativeOffset(m.nativeOffset, 'model', m.name);
        const address = mapAddress(m.name, nativeOffset);
        const stableKey = `model:${mapId}:offset-${nativeOffset.toString(16)}`;
        return {
            id: stableKey,
            stableKey,
            address,
            mapId,
            name: m.name,
            kind: 'model',
            family: 'model',
            typeId: m.typeId ?? 0,
            nativeOffset
        };
    });
    const parts = input.parts.map((p, idx) => {
        const nativeOffset = requireNativeOffset(p.nativeOffset, 'part', p.name);
        const address = mapAddress(p.name, nativeOffset);
        const stableKey = `part:${mapId}:offset-${nativeOffset.toString(16)}`;
        const modelIndex = p.modelIndex ?? 0;
        const modelName = models[modelIndex]?.name ?? (p.modelIndex !== undefined ? `model_${p.modelIndex}` : 'unknown');
        return {
            id: stableKey,
            stableKey,
            address,
            mapId,
            name: p.name,
            kind: 'part',
            family: 'part',
            typeId: p.typeId,
            modelIndex,
            modelName,
            transform: {
                position: [p.posX, p.posY, p.posZ],
                rotation: [p.rotX ?? 0, p.rotY ?? 0, p.rotZ ?? 0],
                scale: [p.scaleX ?? 1, p.scaleY ?? 1, p.scaleZ ?? 1]
            },
            nativeOffset,
            ...(p.internalEntryId !== undefined ? { internalEntryId: p.internalEntryId } : {}),
            ...(p.entityId !== undefined ? { entityId: p.entityId } : {}),
            ...(p.npcParamRowId !== undefined ? { npcParamRowId: p.npcParamRowId } : {})
        };
    });
    const regions = (input.regions ?? []).map((r, idx) => {
        const nativeOffset = requireNativeOffset(r.nativeOffset, 'region', r.name);
        const address = mapAddress(r.name, nativeOffset);
        const stableKey = `region:${mapId}:offset-${nativeOffset.toString(16)}`;
        return {
            id: stableKey,
            stableKey,
            address,
            mapId,
            name: r.name,
            kind: 'region',
            family: 'region',
            typeId: r.typeId,
            shapeType: r.shapeType ?? r.shape ?? 0,
            ...(r.shapeData !== undefined ? { shapeData: r.shapeData } : {}),
            transform: {
                position: [r.posX, r.posY, r.posZ],
                rotation: [r.rotX ?? 0, r.rotY ?? 0, r.rotZ ?? 0]
            },
            nativeOffset,
            ...(r.internalEntryId !== undefined ? { internalEntryId: r.internalEntryId } : {}),
            ...(r.entityId !== undefined ? { entityId: r.entityId } : {})
        };
    });
    const events = (input.events ?? []).map((e, idx) => {
        const nativeOffset = requireNativeOffset(e.nativeOffset, 'event', e.name);
        const address = mapAddress(e.name, nativeOffset);
        const stableKey = `event:${mapId}:offset-${nativeOffset.toString(16)}`;
        return {
            id: stableKey,
            stableKey,
            address,
            mapId,
            name: e.name,
            kind: 'event',
            family: 'event',
            typeId: e.typeId,
            ...(e.eventId !== undefined ? { eventId: e.eventId } : {}),
            nativeOffset
        };
    });
    const routes = (input.routes ?? []).map((rt, idx) => {
        const nativeOffset = requireNativeOffset(rt.nativeOffset, 'route', rt.name);
        const address = mapAddress(rt.name, nativeOffset);
        const stableKey = `route:${mapId}:offset-${nativeOffset.toString(16)}`;
        return {
            id: stableKey,
            stableKey,
            address,
            mapId,
            name: rt.name,
            kind: 'route',
            family: 'route',
            typeId: rt.typeId,
            ...(rt.id !== undefined ? { routeId: rt.id } : {}),
            nativeOffset
        };
    });
    const totalEntityCount = models.length + parts.length + regions.length + events.length + routes.length;
    return {
        sourceUri: input.sourceUri,
        sourcePath: input.sourcePath,
        mapId,
        game: input.game,
        revision: input.revision,
        ...(input.readerSchemaRevision !== undefined ? { readerSchemaRevision: input.readerSchemaRevision } : {}),
        ...(input.entityIdVerified !== undefined ? { entityIdVerified: input.entityIdVerified } : {}),
        models,
        parts,
        regions,
        events,
        routes,
        totalEntityCount
    };
}
function nativeIdentityKey(family, nativeOffset) {
    return `${family}:${nativeOffset}`;
}
/**
 * 实体选择器：`<mapId>#<name>[@0x<offset>]`、`<name>@0x<offset>`，或裸名字。
 * 地址属于别的块时返回 undefined，让上层报「不属于本图」而不是按同名猜一个。
 */
function mapEntityNameSelector(identifier, mapId) {
    const address = parseMapAddress(identifier);
    if (address?.name !== undefined && address.name !== '') {
        if (address.block !== mapId)
            return undefined;
        return {
            name: address.name,
            ...(address.nativeOffset === undefined ? {} : { nativeOffset: address.nativeOffset })
        };
    }
    const bare = /^(.+?)@0x([0-9a-f]+)$/i.exec(identifier.trim());
    if (bare !== null) {
        const nativeOffset = Number(`0x${bare[2]}`);
        if (Number.isSafeInteger(nativeOffset) && nativeOffset >= 0)
            return { name: bare[1], nativeOffset };
    }
    return undefined;
}
function requireNativeOffset(value, family, name) {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`MAP_NATIVE_OFFSET_REQUIRED: ${family} ${name} 缺少有效 nativeOffset，已失败关闭。`);
    }
    return value;
}
function resolveBlenderTarget(doc, mutation) {
    if (mutation.family === undefined || mutation.nativeOffset === undefined) {
        return {
            ok: false,
            conflict: true,
            error: `MAP_NATIVE_OFFSET_REQUIRED: Blender ${mutation.action} 必须携带 family + nativeOffset (${mutation.stableKey})`
        };
    }
    const sceneGraph = new MapSceneGraph(doc);
    const resolved = sceneGraph.resolveNativeIdentity({
        family: mutation.family,
        nativeOffset: mutation.nativeOffset
    });
    if (!resolved.ok) {
        return {
            ok: false,
            conflict: true,
            error: `MAP_NATIVE_IDENTITY_NOT_FOUND: ${mutation.family}@${mutation.nativeOffset}`
        };
    }
    if (resolved.entity.stableKey !== mutation.stableKey) {
        return {
            ok: false,
            conflict: true,
            error: `MAP_NATIVE_IDENTITY_MISMATCH: stableKey 与 family/nativeOffset 不一致 (${mutation.stableKey})`
        };
    }
    return { ok: true, entity: resolved.entity };
}
function assertNeverBlenderAction(value) {
    throw new Error(`未处理的 Blender action: ${String(value)}`);
}
//# sourceMappingURL=map-document.js.map