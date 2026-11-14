import { randomUUID } from 'node:crypto';
export class SceneExportLeaseStore {
    leases = new Map();
    open(input) {
        if (!input.owner || !input.workspaceId || input.expiresAt <= Date.now())
            throw new Error('SCENE_LEASE_INVALID');
        const lease = { ...input, exportSessionId: randomUUID(), closed: false, objectAllowlist: [...new Set(input.objectAllowlist)], assetAllowlist: [...new Set(input.assetAllowlist)], sourceVersions: { ...input.sourceVersions } };
        this.leases.set(lease.exportSessionId, lease);
        return structuredClone(lease);
    }
    registerSnapshot(snapshot, owner) {
        return this.open({
            owner,
            workspaceId: snapshot.workspaceId,
            sourceVersions: { [snapshot.sceneResourceIdentity.sourceUri]: snapshot.snapshotVersion },
            objectAllowlist: snapshot.objects.map((object) => object.objectHandle),
            assetAllowlist: snapshot.assetRefs.map((asset) => asset.assetHandle),
            coordinateProfileHash: snapshot.coordinateProfileHash,
            expiresAt: Date.now() + 10 * 60_000,
            sceneResourceIdentity: snapshot.sceneResourceIdentity
        });
    }
    get(exportSessionId) {
        const lease = this.leases.get(exportSessionId);
        return lease ? structuredClone(lease) : undefined;
    }
    requireAuthorized(exportSessionId, owner, workspaceId) {
        const lease = this.leases.get(exportSessionId);
        if (!lease || lease.closed || lease.owner !== owner || lease.workspaceId !== workspaceId)
            throw new Error('SCENE_LEASE_UNAUTHORIZED');
        if (lease.expiresAt <= Date.now()) {
            lease.closed = true;
            throw new Error('SCENE_LEASE_EXPIRED');
        }
        return structuredClone(lease);
    }
    close(exportSessionId, owner) {
        const lease = this.leases.get(exportSessionId);
        if (!lease || lease.owner !== owner)
            throw new Error('SCENE_LEASE_UNAUTHORIZED');
        lease.closed = true;
    }
}
//# sourceMappingURL=sceneExportLeaseStore.js.map