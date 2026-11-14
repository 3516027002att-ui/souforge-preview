import { createHash } from 'node:crypto';
export function makeWorkspacePersistentIdentityHash(args) {
    const h = createHash('sha256');
    h.update(args.workspaceId);
    h.update('\0');
    h.update(args.game);
    h.update('\0');
    h.update(args.physicalOverlayRootHash);
    if (args.physicalBaseRootHash) {
        h.update('\0');
        h.update(args.physicalBaseRootHash);
    }
    return h.digest('hex');
}
export function fingerprintEquals(a, b) {
    return a.relativePath === b.relativePath
        && a.size === b.size
        && a.mtimeNs === b.mtimeNs
        && a.ctimeNs === b.ctimeNs
        && a.fileIdentity === b.fileIdentity
        && a.pathSourceGeneration === b.pathSourceGeneration;
}
export function makeFileFingerprint(args) {
    return {
        relativePath: args.relativePath,
        size: args.size,
        mtimeNs: args.mtimeNs,
        ctimeNs: args.ctimeNs,
        fileIdentity: args.fileIdentity,
        pathSourceGeneration: args.pathSourceGeneration,
    };
}
export function canReusePersistedHash(args) {
    if (!args.persisted)
        return { reuse: false, reason: 'no-persisted' };
    if (!args.workspaceIdentityMatches)
        return { reuse: false, reason: 'workspace-mismatch' };
    if (args.continuity.continuity !== 'PROVEN')
        return { reuse: false, reason: `continuity-${args.continuity.continuity}` };
    if (args.persisted.fingerprintStoreGeneration !== args.currentStoreGeneration)
        return { reuse: false, reason: 'store-generation-mismatch' };
    if (args.persisted.fileIdentity === null)
        return { reuse: false, reason: 'fileIdentity-null' };
    if (!fingerprintEquals(args.fingerprint, {
        relativePath: args.persisted.relativePath,
        size: args.persisted.size,
        mtimeNs: args.persisted.mtimeNs,
        ctimeNs: args.persisted.ctimeNs,
        fileIdentity: args.persisted.fileIdentity,
        pathSourceGeneration: args.persisted.pathSourceGeneration,
    }))
        return { reuse: false, reason: 'fingerprint-mismatch' };
    return { reuse: true, reason: 'hit' };
}
export function normalizeMtimeNs(stat) {
    if (typeof stat.mtimeNs === 'bigint')
        return stat.mtimeNs.toString();
    return String(BigInt(Math.trunc(stat.mtimeMs * 1_000_000)));
}
export function normalizeCtimeNs(stat) {
    if (typeof stat.ctimeNs === 'bigint')
        return stat.ctimeNs.toString();
    const ms = typeof stat.ctimeMs === 'number' ? stat.ctimeMs : (stat.birthtimeMs ?? 0);
    return String(BigInt(Math.trunc(ms * 1_000_000)));
}
export function fileIdentityFromStat(stat) {
    if (stat.dev !== undefined && stat.ino !== undefined)
        return `${String(stat.dev)}:${String(stat.ino)}`;
    return null;
}
/** For tests: build a persisted entry quickly */
export function toPersistedHash(fp, sha256, storeGen) {
    return { ...fp, sha256, lastVerifiedAtUtc: new Date().toISOString(), fingerprintStoreGeneration: storeGen };
}
//# sourceMappingURL=fileFingerprint.js.map