import { evidenceKey, evidenceResourceKey, normalizeEvidenceIdentity } from '../../../model-services/evidenceIdentity.js';
export function makeIdentity(options = {}) {
    return normalizeEvidenceIdentity({
        workspaceId: 'ws-sf19',
        canonicalOuterId: options.outer ?? 'outer-a',
        childChain: options.childChain ?? ['entry0'],
        domain: options.domain ?? 'param',
        namespace: options.namespace ?? 'NpcParam',
        objectHandle: options.objectHandle ?? 'row:100',
        propertyKey: options.propertyKey ?? 'hp',
        ...(options.language !== undefined ? { language: options.language } : {}),
        ...(options.formatProfileId !== undefined ? { formatProfileId: options.formatProfileId } : {})
    });
}
export function makeVersion(options = {}) {
    return {
        revision: 'rev-current',
        outerHash: 'outer-hash-current',
        readerSchemaHash: 'reader-schema-1',
        metadataSchemaHash: 'metadata-schema-1',
        workspaceEpoch: 1,
        ...options
    };
}
export function makeClaim(identity, options = {}) {
    return {
        identity,
        key: evidenceKey(identity),
        resourceKey: evidenceResourceKey(identity),
        handle: options.handle ?? `${identity.canonicalOuterId}#${identity.objectHandle}`,
        text: options.text ?? 'native fact',
        version: options.version ?? makeVersion(),
        authority: options.authority ?? 3,
        authorityClass: options.authorityClass ?? 'native',
        required: options.required ?? false,
        relevance: options.relevance ?? 0,
        observationSequence: options.sequence ?? 0,
        sequence: options.sequence ?? 0,
        ...(options.dependencyRole !== undefined ? { dependencyRole: options.dependencyRole } : {}),
        ...(options.goalRefs !== undefined ? { goalRefs: options.goalRefs } : {}),
        ...(options.title !== undefined ? { title: options.title } : {})
    };
}
export function currentVersionMap(claims) {
    return new Map(claims.map((claim) => [claim.resourceKey, claim.version]));
}
//# sourceMappingURL=fixtures.js.map