const CONTAINER_ROLES = new Set([
    'none', 'gameparam-binder', 'drawparam-binder', 'msg-binder', 'script-binder',
    'behavior-binder', 'animation-binder', 'texture-binder', 'vfx-binder', 'generic-binder'
]);
const CONFIRMED_LEAF_FORMATS = new Set([
    'dcx-dflt', 'dcx-krak', 'bnd4', 'param', 'gparam', 'fmg', 'emevd', 'msb',
    'lua-source', 'lua-bytecode', 'hks-bytecode', 'esd', 'tae', 'flver', 'tpf',
    'dds', 'mtd', 'matbin', 'fxr'
]);
function normalizeContainerRole(role) {
    return CONTAINER_ROLES.has(role) ? role : 'generic-binder';
}
function normalizeFormatId(formatId) {
    if (!CONFIRMED_LEAF_FORMATS.has(formatId)) {
        throw new Error(`probe 返回了未登记格式 ${formatId}，拒绝构造 locator。`);
    }
    return formatId;
}
/**
 * 只把 Bridge-confirmed 层组装进 locator；`unknown` 层不得成为 confirmed
 * format。probe 已判 conflict/blocked 时失败关闭，不静默单选。
 */
export function buildNativeDocumentLocator(input) {
    const { bridgeValue } = input;
    if (bridgeValue.probeStatus === 'blocked') {
        return {
            kind: 'blocked',
            reasonCode: bridgeValue.reasonCode === 'compression-runtime-unavailable'
                ? 'compression-runtime-unavailable'
                : 'bridge-runtime-unavailable',
            bridgeMessage: null
        };
    }
    if (bridgeValue.probeStatus === 'conflict') {
        return { kind: 'conflict', confirmedStackIds: bridgeValue.confirmedStackIds };
    }
    if (bridgeValue.probeStatus !== 'confirmed') {
        return {
            kind: 'unsupported',
            reasonCode: bridgeValue.reasonCode ?? `probe-status-${bridgeValue.probeStatus}`
        };
    }
    const layers = [];
    const confirmedChildren = [];
    for (const layer of bridgeValue.layers) {
        if (layer.formatId === 'unknown')
            continue;
        const normalized = normalizeFormatId(layer.formatId);
        if (layer.entry === null) {
            layers.push({ layerIndex: layer.layerIndex, formatId: normalized, entry: null });
            continue;
        }
        // child 层的 parentLayerIndex 指向外层容器层（最近且索引更小的
        // bnd4/dcx 容器根层）。
        const parentLayer = bridgeValue.layers
            .filter((candidate) => candidate.entry === null && candidate.layerIndex < layer.layerIndex)
            .filter((candidate) => candidate.formatId === 'bnd4' || candidate.formatId === 'dcx-dflt' || candidate.formatId === 'dcx-krak')
            .sort((a, b) => b.layerIndex - a.layerIndex)[0];
        layers.push({
            layerIndex: layer.layerIndex,
            formatId: normalized,
            entry: {
                parentLayerIndex: parentLayer?.layerIndex ?? 0,
                stableEntryId: layer.entry.stableEntryId,
                entryIndex: layer.entry.entryIndex,
                entryName: layer.entry.entryName,
                expectedEntryHash: layer.entry.expectedEntryHash
            }
        });
        if (normalized !== 'bnd4') {
            confirmedChildren.push({ layerIndex: layer.layerIndex, stableEntryId: layer.entry.stableEntryId });
        }
    }
    const leafDocumentStableId = confirmedChildren.length > 0
        ? confirmedChildren[confirmedChildren.length - 1].stableEntryId
        : bridgeValue.leafFormatId === 'bnd4'
            ? 'bnd4-root'
            : `loose:${bridgeValue.leafFormatId}`;
    const locator = {
        locatorId: `locator:${input.outerResourceId}:${input.expectedOuterRevision}`,
        outerResourceId: input.outerResourceId,
        outerSourceUri: input.outerSourceUri,
        sourceVariant: input.sourceVariant,
        expectedOuterRevision: input.expectedOuterRevision,
        expectedOuterHash: bridgeValue.outerHash,
        containerRole: normalizeContainerRole(bridgeValue.containerRole),
        layers,
        leafDocumentStableId
    };
    return { kind: 'confirmed', locator };
}
//# sourceMappingURL=nativeDocumentLocator.js.map