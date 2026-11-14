/**
 * MSB Bridge read helper for desktop scene / workbench (renderer-safe DTOs only).
 *
 * 三层截断移除后，默认返回 Bridge 完整实体表（models/parts/regions/events/routes）。
 * maxParts/maxRegions/maxModels/maxEvents 仅在调用方显式传入时作为有界窗口
 * （scaleAccess=bounded-window），默认不截断。
 */
import { runBridge } from '../bridge/runBridge.js';
import { BRIDGE_TRANSPORT_TIMING_CODE } from '../bridge/bridgeTransportTiming.js';
export async function readMsbDocumentViaBridge(input) {
    const result = await runBridge({
        command: 'read-msb-document',
        filePath: input.sourcePath,
        allowedRoots: input.allowedRoots,
        timeoutMs: input.timeoutMs ?? 120_000,
        ...(input.workspaceSessionId !== undefined ? { workspaceSessionId: input.workspaceSessionId } : {}),
        ...(input.diagnosticTimings === true ? { commandOptions: { diagnosticTimings: true } } : {}),
        ...(input.oodleRuntimeRoot ? { oodleRuntimeRoot: input.oodleRuntimeRoot } : {})
    });
    const diagnostics = result.diagnostics.map((d) => ({
        severity: d.severity,
        code: d.code,
        message: d.message,
        ...(input.diagnosticTimings === true
            && (d.code === 'MSB_NATIVE_TIMINGS' || d.code === BRIDGE_TRANSPORT_TIMING_CODE)
            && d.details !== undefined
            ? { details: d.details } : {})
    }));
    if (result.parseStatus === 'failed' || !result.data?.sourceHash) {
        return {
            ok: false,
            diagnostics
        };
    }
    const bounded = (count, defaultValue) => count === undefined ? defaultValue : count;
    const maxParts = bounded(input.maxParts, Number.MAX_SAFE_INTEGER);
    const maxRegions = bounded(input.maxRegions, Number.MAX_SAFE_INTEGER);
    const maxModels = bounded(input.maxModels, Number.MAX_SAFE_INTEGER);
    const maxEvents = bounded(input.maxEvents, Number.MAX_SAFE_INTEGER);
    const models = (result.data.models ?? []).slice(0, maxModels).map((model) => ({
        name: String(model.name ?? ''),
        ...(model.offset === undefined ? {} : { nativeOffset: Number(model.offset) }),
        typeId: Number(model.typeId ?? 0)
    }));
    const parts = (result.data.parts ?? []).slice(0, maxParts).map((p) => ({
        name: String(p.name ?? ''),
        ...(p.offset === undefined ? {} : { nativeOffset: Number(p.offset) }),
        typeId: Number(p.typeId ?? 0),
        ...(p.modelIndex === undefined ? {} : { modelIndex: Number(p.modelIndex) }),
        posX: Number(p.posX ?? 0),
        posY: Number(p.posY ?? 0),
        posZ: Number(p.posZ ?? 0),
        ...(p.rotX !== undefined ? { rotX: Number(p.rotX) } : {}),
        ...(p.rotY !== undefined ? { rotY: Number(p.rotY) } : {}),
        ...(p.rotZ !== undefined ? { rotZ: Number(p.rotZ) } : {}),
        ...(p.scaleX !== undefined ? { scaleX: Number(p.scaleX) } : {}),
        ...(p.scaleY !== undefined ? { scaleY: Number(p.scaleY) } : {}),
        ...(p.scaleZ !== undefined ? { scaleZ: Number(p.scaleZ) } : {}),
        ...(p.internalEntryId !== undefined ? { internalEntryId: Number(p.internalEntryId) } : {}),
        ...(p.entityId !== undefined ? { entityId: Number(p.entityId) } : {}),
        ...(p.entityGroupId !== undefined ? { entityGroupId: Number(p.entityGroupId) } : {}),
        ...(p.npcParamRowId !== undefined ? { npcParamRowId: Number(p.npcParamRowId) } : {}),
        ...(typeof p.model === 'string' ? { model: p.model } : {})
    }));
    const regions = (result.data.regions ?? []).slice(0, maxRegions).map((r) => ({
        name: String(r.name ?? ''),
        ...(r.offset === undefined ? {} : { nativeOffset: Number(r.offset) }),
        typeId: Number(r.typeId ?? 0),
        ...(r.shapeType !== undefined ? { shapeType: Number(r.shapeType) } : {}),
        posX: Number(r.posX ?? 0),
        posY: Number(r.posY ?? 0),
        posZ: Number(r.posZ ?? 0),
        ...(r.rotX !== undefined ? { rotX: Number(r.rotX) } : {}),
        ...(r.rotY !== undefined ? { rotY: Number(r.rotY) } : {}),
        ...(r.rotZ !== undefined ? { rotZ: Number(r.rotZ) } : {}),
        ...(r.scaleX !== undefined ? { scaleX: Number(r.scaleX) } : {}),
        ...(r.scaleY !== undefined ? { scaleY: Number(r.scaleY) } : {}),
        ...(r.scaleZ !== undefined ? { scaleZ: Number(r.scaleZ) } : {}),
        ...(r.internalEntryId !== undefined ? { internalEntryId: Number(r.internalEntryId) } : {}),
        ...(r.entityId !== undefined ? { entityId: Number(r.entityId) } : {})
    }));
    const events = (result.data.events ?? []).slice(0, maxEvents).map((event) => ({
        name: String(event.name ?? ''),
        ...(event.offset === undefined ? {} : { nativeOffset: Number(event.offset) }),
        typeId: Number(event.typeId ?? 0),
        ...(event.eventId === undefined ? {} : { eventId: Number(event.eventId) })
    }));
    const routes = (result.data.routes ?? []).map((route) => ({
        name: String(route.name ?? ''),
        ...(route.offset === undefined ? {} : { nativeOffset: Number(route.offset) }),
        typeId: Number(route.typeId ?? 0),
        ...(route.id === undefined ? {} : { id: Number(route.id) })
    }));
    return {
        ok: true,
        data: {
            sourceHash: result.data.sourceHash,
            version: result.data.version ?? 0,
            modelCount: result.data.modelCount ?? 0,
            partCount: result.data.partCount ?? 0,
            regionCount: result.data.regionCount ?? 0,
            eventCount: result.data.eventCount ?? 0,
            routeCount: result.data.routeCount ?? 0,
            models,
            parts,
            regions,
            events,
            routes,
            ...(result.data.authority ? { authority: result.data.authority } : {}),
            ...(result.data.readerSchemaRevision !== undefined ? { readerSchemaRevision: Number(result.data.readerSchemaRevision) } : {}),
            ...(result.data.entityEdit ? { entityEdit: result.data.entityEdit } : {})
        },
        diagnostics
    };
}
//# sourceMappingURL=msbBridgeRead.js.map