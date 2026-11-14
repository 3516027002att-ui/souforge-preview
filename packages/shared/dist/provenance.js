/**
 * Provenance chain model (architecture fork #105).
 * Every field, reference, diagnostic, and patch should be able to attach provenance.
 *
 * Synthetic fixtures must never claim native format authority.
 */
export function createProvenanceSource(partial) {
    const syntheticFixture = partial.syntheticFixture ?? partial.kind === 'synthetic_fixture';
    const nativeFormatAuthority = syntheticFixture
        ? false
        : (partial.nativeFormatAuthority ?? false);
    const source = {
        kind: partial.kind,
        id: partial.id,
        nativeFormatAuthority,
        syntheticFixture
    };
    if (partial.label !== undefined)
        source.label = partial.label;
    if (partial.recordedAt !== undefined)
        source.recordedAt = partial.recordedAt;
    if (partial.contentHash !== undefined)
        source.contentHash = partial.contentHash;
    if (partial.details !== undefined)
        source.details = partial.details;
    return source;
}
export function createSyntheticFixtureProvenance(fixtureId, label) {
    return createProvenanceSource({
        kind: 'synthetic_fixture',
        id: fixtureId,
        label: label ?? `Synthetic fixture ${fixtureId}`,
        recordedAt: new Date().toISOString(),
        syntheticFixture: true,
        nativeFormatAuthority: false
    });
}
export function createParserProvenance(parserId, options) {
    return createProvenanceSource({
        kind: 'parser',
        id: parserId,
        label: options?.label ?? parserId,
        recordedAt: new Date().toISOString(),
        nativeFormatAuthority: options?.nativeFormatAuthority ?? false,
        syntheticFixture: options?.syntheticFixture ?? false,
        ...(options?.details ? { details: options.details } : {})
    });
}
export function assertNoSyntheticNativeAuthority(source) {
    if (source.syntheticFixture && source.nativeFormatAuthority) {
        throw new Error(`Provenance source ${source.id} marks syntheticFixture=true with nativeFormatAuthority=true, which is forbidden.`);
    }
}
export function provenanceClaimsNativeAuthority(chain) {
    return chain.sources.some((source) => source.nativeFormatAuthority && !source.syntheticFixture);
}
//# sourceMappingURL=provenance.js.map