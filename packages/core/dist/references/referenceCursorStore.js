/**
 * Host-owned continuation state for content reference pages.
 *
 * A cursor is deliberately opaque.  The token is a random nonce bound to a
 * digest, while the store retains the complete query scope and snapshot
 * identity.  This prevents an offset-only token from being replayed against a
 * different workspace/query/source version and keeps cursor state read-only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const CURSOR_PREFIX = 'rf2_';
const DEFAULT_MAX_ENTRIES = 1024;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
function stableJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableJson).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
function positiveSafeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function validState(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const state = value;
    return typeof state.token === 'string'
        && state.token.startsWith(CURSOR_PREFIX)
        && typeof state.workspaceId === 'string'
        && typeof state.rootUri === 'string'
        && typeof state.sourceVersionKey === 'string'
        && typeof state.scope === 'object'
        && state.scope !== null
        && positiveSafeInteger(state.relationOffset)
        && typeof state.dependencySummary === 'object'
        && state.dependencySummary !== null
        && positiveSafeInteger(state.issuedAt)
        && positiveSafeInteger(state.expiresAt);
}
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}
function tokenFor(state, issuedAt) {
    const binding = stableJson({
        workspaceId: state.workspaceId,
        scope: state.scope,
        rootUri: state.rootUri,
        relationOffset: state.relationOffset,
        sourceOffset: state.sourceOffset,
        sourceScanState: state.sourceScanState,
        sourceVersionKey: state.sourceVersionKey,
        dependencySummary: state.dependencySummary,
        providerRegistryDigest: state.providerRegistryDigest,
        issuedAt
    });
    const digest = createHash('sha256').update(binding).digest('hex').slice(0, 24);
    return `${CURSOR_PREFIX}${randomBytes(24).toString('base64url')}_${digest}`;
}
class BaseReferenceCursorStore {
    maxEntries;
    ttlMs;
    now;
    constructor(options = {}) {
        this.maxEntries = Number.isSafeInteger(options.maxEntries) && (options.maxEntries ?? 0) > 0
            ? options.maxEntries : DEFAULT_MAX_ENTRIES;
        this.ttlMs = Number.isSafeInteger(options.ttlMs) && (options.ttlMs ?? 0) > 0
            ? options.ttlMs : DEFAULT_TTL_MS;
        this.now = options.now ?? Date.now;
    }
    issue(state) {
        if (!state.workspaceId || !state.rootUri || !state.sourceVersionKey || !positiveSafeInteger(state.relationOffset)) {
            throw new Error('REFERENCE_CURSOR_STATE_INVALID');
        }
        const now = Math.max(0, Math.floor(this.now()));
        const entries = this.prune(this.readAll(), now);
        const issued = {
            ...state,
            token: tokenFor(state, now),
            issuedAt: now,
            expiresAt: now + this.ttlMs
        };
        entries.set(issued.token, issued);
        while (entries.size > this.maxEntries) {
            const oldest = [...entries.values()].sort((a, b) => a.issuedAt - b.issuedAt)[0];
            if (!oldest)
                break;
            entries.delete(oldest.token);
        }
        this.writeAll(entries);
        return issued.token;
    }
    put(state) {
        return this.issue(state);
    }
    get(token) {
        if (typeof token !== 'string' || !token.startsWith(CURSOR_PREFIX))
            return undefined;
        const entries = this.prune(this.readAll(), Math.max(0, Math.floor(this.now())));
        const found = entries.get(token);
        this.writeAll(entries);
        return found ? cloneState(found) : undefined;
    }
    delete(token) {
        const entries = this.readAll();
        if (entries.delete(token))
            this.writeAll(entries);
    }
    clear() {
        this.writeAll(new Map());
    }
    prune(entries, now) {
        for (const [token, entry] of entries) {
            if (!validState(entry) || entry.expiresAt <= now)
                entries.delete(token);
        }
        return entries;
    }
}
export class MemoryReferenceCursorStore extends BaseReferenceCursorStore {
    entries = new Map();
    readAll() {
        return this.entries;
    }
    writeAll(entries) {
        this.entries = entries;
    }
}
/** Default store shared by all ReferenceQueryService instances in this host. */
export function createReferenceCursorStore(options = {}) {
    return new MemoryReferenceCursorStore(options);
}
const defaultStore = createReferenceCursorStore();
export const defaultReferenceCursorStore = defaultStore;
/**
 * JSON-backed store for a managed `.soulforge`/CLI directory.  It refreshes on
 * every operation so a one-shot CLI process can continue a cursor minted by a
 * previous process.  Writes are atomic within the managed directory.
 */
export class ManagedReferenceCursorStore extends BaseReferenceCursorStore {
    filePath;
    constructor(directory, options = {}) {
        super(options);
        if (!directory || directory.trim().length === 0)
            throw new Error('REFERENCE_CURSOR_DIRECTORY_REQUIRED');
        this.filePath = join(directory, options.fileName ?? 'reference-cursors.json');
    }
    readAll() {
        try {
            if (!existsSync(this.filePath))
                return new Map();
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(parsed))
                return new Map();
            const entries = new Map();
            for (const value of parsed) {
                if (validState(value))
                    entries.set(value.token, value);
            }
            return entries;
        }
        catch {
            // A corrupt/stale cursor cache is equivalent to an expired cache. It
            // cannot authorize or affect any writer operation.
            return new Map();
        }
    }
    writeAll(entries) {
        const parent = dirname(this.filePath);
        if (parent)
            mkdirSync(parent, { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.tmp`;
        writeFileSync(tempPath, JSON.stringify([...entries.values()]), 'utf8');
        renameSync(tempPath, this.filePath);
    }
}
export function createManagedReferenceCursorStore(directory, options = {}) {
    return new ManagedReferenceCursorStore(directory, options);
}
/** Backward/host-friendly aliases. */
export const createMemoryReferenceCursorStore = createReferenceCursorStore;
//# sourceMappingURL=referenceCursorStore.js.map