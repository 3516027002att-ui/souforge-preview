function exactKey(key) {
    return `${key.outerSource}|${key.version}|${key.readerKind}|${key.schema}|${key.shape}`;
}
export class NativeSnapshotCache {
    entries = new Map();
    inflight = new Map();
    lru = [];
    bytes = 0;
    disposed = false;
    /** 每 key 单调世代：失效即递增，晚到的旧结果凭此识别并丢弃。 */
    epochs = new Map();
    maxBytes;
    maxEntries;
    constructor(options = {}) {
        this.maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
        this.maxEntries = options.maxEntries ?? 256;
    }
    getExact(key) {
        const entry = this.entries.get(exactKey(key));
        if (!entry)
            return undefined;
        this.touch(exactKey(key));
        return entry.data;
    }
    async readThrough(key, waiterId, load, signal) {
        if (this.disposed)
            throw new Error('SNAPSHOT_CACHE_DISPOSED');
        const name = exactKey(key);
        const hit = this.entries.get(name);
        if (hit) {
            this.touch(name);
            return hit.data;
        }
        let flight = this.inflight.get(name);
        if (!flight) {
            let resolve;
            let reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            const epoch = this.epochs.get(name) ?? 0;
            flight = { promise, waiters: new Set(), cancelled: new Set(), underlyingCancelled: false };
            this.inflight.set(name, flight);
            void load().then((loaded) => {
                // 失效/关闭后晚到的结果不得覆盖新世代，也不得送达旧 waiter。
                if (this.disposed || (this.epochs.get(name) ?? 0) !== epoch) {
                    this.inflight.delete(name);
                    reject(new Error('SNAPSHOT_SOURCE_CHANGED'));
                    return;
                }
                this.inflight.delete(name);
                if (flight.waiters.size === flight.cancelled.size) {
                    // 全部 waiter 已取消：底层结果丢弃，等待者以取消结束，不悬挂。
                    reject(new Error('SNAPSHOT_WAIT_CANCELLED'));
                    return;
                }
                this.store(name, loaded.data, loaded.bytes);
                resolve(loaded.data);
            }).catch((error) => {
                this.inflight.delete(name);
                reject(error);
            });
        }
        flight.waiters.add(waiterId);
        if (signal?.aborted) {
            this.cancelWaiter(name, waiterId);
            throw new Error('SNAPSHOT_WAIT_CANCELLED');
        }
        const data = await flight.promise;
        if (flight.cancelled.has(waiterId))
            throw new Error('SNAPSHOT_WAIT_CANCELLED');
        return data;
    }
    cancelWaiter(name, waiterId) {
        const flight = this.inflight.get(name);
        if (!flight)
            return;
        flight.cancelled.add(waiterId);
        if (flight.waiters.size === flight.cancelled.size)
            flight.underlyingCancelled = true;
    }
    pin(name) {
        const entry = this.entries.get(name);
        if (entry)
            entry.pinned += 1;
    }
    unpin(name) {
        const entry = this.entries.get(name);
        if (entry && entry.pinned > 0)
            entry.pinned -= 1;
    }
    invalidateOuter(outerSource) {
        for (const name of [...this.entries.keys()]) {
            if (name.startsWith(`${outerSource}|`)) {
                this.entries.delete(name);
                this.epochs.set(name, (this.epochs.get(name) ?? 0) + 1);
            }
        }
        for (const name of [...this.inflight.keys()]) {
            if (name.startsWith(`${outerSource}|`)) {
                this.inflight.delete(name);
                this.epochs.set(name, (this.epochs.get(name) ?? 0) + 1);
            }
        }
    }
    store(name, data, bytes) {
        while ((this.bytes + bytes > this.maxBytes || this.entries.size + 1 > this.maxEntries) && this.lru.length > 0) {
            const victim = this.lru.shift();
            const entry = this.entries.get(victim);
            if (!entry || entry.pinned > 0)
                continue;
            this.entries.delete(victim);
            this.bytes -= entry.bytes;
        }
        this.entries.set(name, { key: name, data, bytes, pinned: 0, generation: Date.now() });
        this.bytes += bytes;
        this.touch(name);
    }
    touch(name) {
        this.lru = this.lru.filter((item) => item !== name);
        this.lru.push(name);
    }
    dispose() {
        this.disposed = true;
        this.entries.clear();
        this.inflight.clear();
        this.lru = [];
        this.bytes = 0;
    }
    get isDisposed() {
        return this.disposed;
    }
}
export class SnapshotCancelledError extends Error {
    code = 'SNAPSHOT_READ_CANCELLED';
    constructor(sourceUri) {
        super(`Snapshot read for '${sourceUri}' was cancelled by its waiter.`);
        this.name = 'SnapshotCancelledError';
    }
}
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 256;
function cacheKeyOf(key) {
    return `${key.sourceUri}\u0000${key.shape}\u0000${key.version}`;
}
function validateKey(key) {
    if (typeof key.sourceUri !== 'string' || key.sourceUri.trim().length === 0) {
        throw new Error('SNAPSHOT_KEY_INVALID: sourceUri must be a non-empty string.');
    }
    if (typeof key.shape !== 'string' || key.shape.trim().length === 0) {
        throw new Error('SNAPSHOT_KEY_INVALID: shape must be a non-empty string.');
    }
    if (typeof key.version !== 'string' || key.version.trim().length === 0) {
        throw new Error('SNAPSHOT_KEY_INVALID: version must be a non-empty string (absent version never caches).');
    }
}
/** Deep freeze so a caller cannot mutate cached arrays / Maps / documents. */
function deepFreeze(value) {
    if (value === null || typeof value !== 'object')
        return value;
    if (Object.isFrozen(value))
        return value;
    Object.freeze(value);
    for (const item of Object.values(value))
        deepFreeze(item);
    return value;
}
/** Rough serialized size; used only for the byte budget, never for identity. */
function estimateBytes(value) {
    try {
        const json = JSON.stringify(value);
        return json ? json.length * 2 : 1024;
    }
    catch {
        return 1024;
    }
}
export function createNativeSnapshotCache(options) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const entries = new Map();
    const inFlight = new Map();
    let seq = 0;
    let totalBytes = 0;
    let disposed = false;
    const stats = { coalescedWaiters: 0, hits: 0, misses: 0 };
    function assertOpen() {
        if (disposed)
            throw new Error('SNAPSHOT_CACHE_DISPOSED: cache has been disposed.');
    }
    function evictIfNeeded() {
        // LRU by last-use sequence; only entries with no active in-flight share.
        while (entries.size > maxEntries || totalBytes > maxBytes) {
            let victimKey;
            let victimSeq = Number.POSITIVE_INFINITY;
            for (const [key, entry] of entries) {
                if (entry.seq < victimSeq) {
                    victimSeq = entry.seq;
                    victimKey = key;
                }
            }
            if (victimKey === undefined)
                break;
            const victim = entries.get(victimKey);
            if (victim)
                totalBytes -= victim.bytes;
            entries.delete(victimKey);
        }
    }
    function publish(key, raw) {
        const frozen = deepFreeze(raw);
        const bytes = estimateBytes(raw);
        const composite = cacheKeyOf(key);
        const existing = entries.get(composite);
        if (existing)
            totalBytes -= existing.bytes;
        entries.set(composite, { value: frozen, bytes, seq: (seq += 1) });
        totalBytes += bytes;
        evictIfNeeded();
        return frozen;
    }
    async function runParse(key) {
        // Backend parse is synchronous in the fixture port; wrap so a throw
        // rejects the shared promise and clears in-flight (never a false hit).
        return await Promise.resolve().then(() => options.backend.parse(key.sourceUri));
    }
    async function read(key, optionsIn = {}) {
        assertOpen();
        validateKey(key);
        const composite = cacheKeyOf(key);
        const { bypass, signal } = optionsIn;
        if (signal?.aborted)
            throw new SnapshotCancelledError(key.sourceUri);
        if (!bypass) {
            const hit = entries.get(composite);
            if (hit) {
                hit.seq = (seq += 1);
                stats.hits += 1;
                return hit.value;
            }
        }
        stats.misses += 1;
        // Bypass never joins an existing in-flight (T03 step 5): it must observe
        // live bytes, then republish a fresh snapshot for subsequent readers.
        let flight;
        let joinsExisting = false;
        if (bypass) {
            flight = newInFlight();
        }
        else {
            const existing = inFlight.get(composite);
            if (existing && !existing.settled) {
                flight = existing;
                joinsExisting = true;
            }
            else {
                flight = newInFlight();
                inFlight.set(composite, flight);
            }
        }
        const value = await new Promise((resolve, reject) => {
            const waiterResolve = (result) => {
                detach();
                resolve(result);
            };
            const waiterReject = (reason) => {
                detach();
                reject(reason);
            };
            const onAbort = () => {
                // Cancelling one waiter removes only that waiter (V06). The shared
                // parse continues while other waiters remain.
                flight.waiters.delete(waiterResolve);
                flight.rejecters.delete(waiterReject);
                detach();
                reject(new SnapshotCancelledError(key.sourceUri));
            };
            const detach = () => {
                if (signal)
                    signal.removeEventListener('abort', onAbort);
            };
            if (signal)
                signal.addEventListener('abort', onAbort, { once: true });
            flight.waiters.add(waiterResolve);
            flight.rejecters.add(waiterReject);
            if (!joinsExisting && !bypass) {
                // Owner of a fresh shared flight: kick off the parse.
                void startParse(flight, key, composite);
            }
            else if (bypass) {
                // Sole owner of a bypass flight.
                void startParse(flight, key, composite);
            }
            else {
                stats.coalescedWaiters += 1;
            }
        });
        return value;
    }
    function newInFlight() {
        return {
            promise: Promise.resolve(),
            waiters: new Set(),
            rejecters: new Set(),
            settled: false
        };
    }
    async function startParse(flight, key, composite) {
        try {
            const raw = await runParse(key);
            flight.settled = true;
            if (disposed) {
                // Late result after dispose must not resurrect a generation (V07).
                for (const reject of [...flight.rejecters])
                    reject(new SnapshotCancelledError(key.sourceUri));
                flight.waiters.clear();
                flight.rejecters.clear();
                inFlight.delete(composite);
                return;
            }
            const frozen = publish(key, raw);
            inFlight.delete(composite);
            for (const resolve of [...flight.waiters])
                resolve(frozen);
            flight.waiters.clear();
            flight.rejecters.clear();
        }
        catch (error) {
            flight.settled = true;
            inFlight.delete(composite);
            for (const reject of [...flight.rejecters])
                reject(error);
            flight.waiters.clear();
            flight.rejecters.clear();
        }
    }
    function invalidate(sourceUri) {
        const prefix = `${sourceUri}\u0000`;
        for (const composite of [...entries.keys()]) {
            if (composite.startsWith(prefix)) {
                const entry = entries.get(composite);
                if (entry)
                    totalBytes -= entry.bytes;
                entries.delete(composite);
            }
        }
    }
    async function dispose() {
        disposed = true;
        for (const flight of inFlight.values()) {
            for (const reject of [...flight.rejecters])
                reject(new SnapshotCancelledError('cache'));
            flight.waiters.clear();
            flight.rejecters.clear();
        }
        inFlight.clear();
        entries.clear();
        totalBytes = 0;
    }
    return {
        read,
        invalidate,
        stats: () => ({ ...stats }),
        dispose
    };
}
//# sourceMappingURL=nativeSnapshotCache.js.map