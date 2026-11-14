export interface CapabilityManifest {
    schemaVersion: 1;
    workspaceId: string;
    mode: 'plan' | 'normal' | 'fullPermission';
    tools: string[];
    memoryAvailable: boolean;
    coverage: Record<string, 'complete' | 'partial' | 'not_indexed' | 'stale' | 'source_unavailable'>;
    nativeWriterProfiles: Record<string, 'unsupported' | 'candidate' | 'native-verified'>;
    oodleAvailable: boolean;
    confirmationRequired: boolean;
    toolSchemaHash: string;
}
export declare function createCapabilityManifest(input: Omit<CapabilityManifest, 'schemaVersion' | 'toolSchemaHash'> & {
    toolSchema?: unknown;
}): CapabilityManifest;
export declare function canRequestOperation(manifest: CapabilityManifest, operation: string): boolean;
export declare function capabilityManifestHash(manifest: CapabilityManifest): string;
