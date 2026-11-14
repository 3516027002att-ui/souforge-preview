/**
 * Renderer-independent scene edit contract.  It carries opaque handles and
 * source identities only; absolute filesystem paths never cross this boundary.
 */
export function isSceneSnapshotV2(value) {
    return Boolean(value && typeof value === 'object' && value.schemaVersion === 2);
}
export function isSceneDeltaV2(value) {
    return Boolean(value && typeof value === 'object' && value.schemaVersion === 2);
}
//# sourceMappingURL=scene-edit-protocol.js.map