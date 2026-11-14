/**
 * Revision-scoped ACTION motion identity cache.
 *
 * A TAE source contains many animIds. The source URI alone is therefore not a
 * sufficient identity for a cached promise; a revision change must also be
 * unable to reuse the old source, and each TAE-entry + animId pair must have
 * its own slot.
 */
export declare class ActionMotionIdentityCache<T> {
    private readonly entries;
    get(sourceUri: string, revisionKey: string, animId: number, entryKey?: string): T | undefined;
    set(sourceUri: string, revisionKey: string, animId: number, value: T, entryKey?: string): void;
    clear(): void;
    get size(): number;
}
