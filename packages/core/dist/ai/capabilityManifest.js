import { createHash } from 'node:crypto';
export function createCapabilityManifest(input) {
    if (!input.workspaceId || !Array.isArray(input.tools))
        throw new Error('CAPABILITY_MANIFEST_INVALID');
    const tools = [...new Set(input.tools)].sort();
    const toolSchemaHash = createHash('sha256').update(JSON.stringify(input.toolSchema ?? tools), 'utf8').digest('hex');
    return { schemaVersion: 1, ...input, tools, toolSchemaHash };
}
export function canRequestOperation(manifest, operation) {
    return manifest.tools.includes(operation)
        && (manifest.mode !== 'plan' || manifest.nativeWriterProfiles[operation] !== 'native-verified');
}
export function capabilityManifestHash(manifest) {
    return createHash('sha256').update(JSON.stringify(manifest), 'utf8').digest('hex');
}
//# sourceMappingURL=capabilityManifest.js.map