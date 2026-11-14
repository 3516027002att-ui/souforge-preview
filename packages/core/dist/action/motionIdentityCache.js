import { TAE_IDENTITY_PROJECTION_VERSION } from '@soulforge/shared';
/**
 * Revision-scoped ACTION motion identity cache.
 *
 * A TAE source contains many animIds. The source URI alone is therefore not a
 * sufficient identity for a cached promise; a revision change must also be
 * unable to reuse the old source, and each TAE-entry + animId pair must have
 * its own slot.
 */
export class ActionMotionIdentityCache {
    entries = new Map();
    get(sourceUri, revisionKey, animId, entryKey = '') {
        return this.entries.get(makeKey(sourceUri, revisionKey, animId, entryKey));
    }
    set(sourceUri, revisionKey, animId, value, entryKey = '') {
        this.entries.set(makeKey(sourceUri, revisionKey, animId, entryKey), value);
    }
    clear() {
        this.entries.clear();
    }
    get size() {
        return this.entries.size;
    }
}
function makeKey(sourceUri, revisionKey, animId, entryKey) {
    return JSON.stringify([TAE_IDENTITY_PROJECTION_VERSION, sourceUri, revisionKey, entryKey, animId]);
}
//# sourceMappingURL=motionIdentityCache.js.map