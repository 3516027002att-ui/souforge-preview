import { createHash, randomUUID } from 'node:crypto';
import { lintKnowledgeGeneration } from './knowledgeLint.js';
import { validateClaimDependencyDag } from './claimGraph.js';
export class KnowledgeStore {
    generations = new Map();
    blobs = new Map();
    current = 'gen-0';
    persistence;
    schemaVersion;
    constructor(schemaVersionOrOptions = 'knowledge-v1', persistence) {
        const options = typeof schemaVersionOrOptions === 'string'
            ? { schemaVersion: schemaVersionOrOptions, ...(persistence ? { persistence } : {}) }
            : schemaVersionOrOptions;
        this.schemaVersion = options.schemaVersion ?? 'knowledge-v1';
        this.persistence = options.persistence;
        const restored = this.persistence?.load() ?? null;
        if (restored) {
            this.restore(restored);
            return;
        }
        const generation = { generationId: 'gen-0', parentGeneration: null, schemaVersion: this.schemaVersion, pages: {}, claims: {}, sourceRevisions: {}, createdAt: new Date(0).toISOString() };
        this.generations.set(generation.generationId, generation);
        this.current = generation.generationId;
        this.persistence?.save(this.snapshot());
    }
    get currentGeneration() { return this.current; }
    getCurrent() { return cloneGeneration(this.requireGeneration(this.current)); }
    readPage(pageId, generationId = this.current) { const page = this.requireGeneration(generationId).pages[pageId]; return page ? structuredClone(page) : undefined; }
    readBlob(hash) { return this.blobs.get(hash); }
    registerBlob(body) {
        const hash = createHash('sha256').update(body, 'utf8').digest('hex');
        const existing = this.blobs.get(hash);
        if (existing !== undefined && existing !== body)
            throw new Error('KNOWLEDGE_BLOB_HASH_COLLISION');
        this.blobs.set(hash, body);
        return hash;
    }
    commitPatch(patch) {
        if (patch.expectedGeneration !== this.current)
            return { ok: false, code: 'CAS_CONFLICT', message: 'CURRENT generation 已变化。' };
        const base = this.requireGeneration(this.current);
        const pages = { ...base.pages };
        const claims = { ...base.claims };
        const nextBlobs = new Map(this.blobs);
        for (const change of patch.pages) {
            const previous = pages[change.pageId];
            if ((previous?.revision ?? null) !== change.expectedRevision)
                return { ok: false, code: 'PAGE_CAS_CONFLICT', message: `page ${change.pageId} revision 已变化。` };
            const contentHash = registerBlobIn(nextBlobs, change.body);
            pages[change.pageId] = { pageId: change.pageId, path: change.path, body: change.body, contentHash, revision: (previous?.revision ?? 0) + 1, scope: change.scope, claims: change.claims?.map((claim) => claim.claimId) ?? previous?.claims ?? [] };
            for (const claim of change.claims ?? [])
                claims[claim.claimId] = structuredClone(claim);
        }
        for (const claim of patch.claims ?? [])
            claims[claim.claimId] = structuredClone(claim);
        const sourceRevisions = { ...base.sourceRevisions };
        for (const source of patch.sourceRevisions)
            sourceRevisions[source.sourceId] = source.storedContentHash;
        const next = { generationId: `gen-${randomUUID()}`, parentGeneration: this.current, schemaVersion: base.schemaVersion, pages, claims, sourceRevisions, createdAt: new Date().toISOString() };
        const findings = lintKnowledgeGeneration(next);
        if (findings.some((finding) => finding.severity === 'error'))
            return { ok: false, code: 'LINT_FAILED', message: 'knowledge generation lint失败。', findings };
        try {
            validateClaimDependencyDag(Object.values(next.claims));
        }
        catch (error) {
            return { ok: false, code: 'LINT_FAILED', message: error instanceof Error ? error.message : String(error) };
        }
        const nextSnapshot = {
            schemaVersion: next.schemaVersion,
            current: next.generationId,
            generations: [...this.generations.values(), next].map(cloneGeneration),
            blobs: Object.fromEntries(nextBlobs.entries())
        };
        try {
            this.persistence?.save(nextSnapshot);
        }
        catch (error) {
            return {
                ok: false,
                code: 'PERSISTENCE_FAILED',
                message: `knowledge generation 未持久化，内存状态未改变：${error instanceof Error ? error.message : String(error)}`
            };
        }
        this.generations.set(next.generationId, next);
        this.blobs = nextBlobs;
        this.current = next.generationId;
        return { ok: true, generation: cloneGeneration(next) };
    }
    sourceRevision(sourceId) { return this.getCurrent().sourceRevisions[sourceId]; }
    generation(generationId) { const value = this.generations.get(generationId); return value ? cloneGeneration(value) : undefined; }
    generationsForRecovery() { return [...this.generations.values()].map(cloneGeneration); }
    requireGeneration(id) { const generation = this.generations.get(id); if (!generation)
        throw new Error('KNOWLEDGE_GENERATION_NOT_FOUND'); return generation; }
    snapshot() {
        return {
            schemaVersion: this.schemaVersion,
            current: this.current,
            generations: [...this.generations.values()].map(cloneGeneration),
            blobs: Object.fromEntries(this.blobs.entries())
        };
    }
    restore(snapshot) {
        if (!snapshot || typeof snapshot.current !== 'string' || !Array.isArray(snapshot.generations)
            || !snapshot.blobs || typeof snapshot.blobs !== 'object') {
            throw new Error('KNOWLEDGE_STORE_SNAPSHOT_INVALID');
        }
        for (const generation of snapshot.generations) {
            if (!generation || typeof generation.generationId !== 'string' || typeof generation.schemaVersion !== 'string'
                || !generation.pages || !generation.claims || !generation.sourceRevisions) {
                throw new Error('KNOWLEDGE_STORE_SNAPSHOT_INVALID');
            }
            this.generations.set(generation.generationId, cloneGeneration(generation));
        }
        if (!this.generations.has(snapshot.current))
            throw new Error('KNOWLEDGE_STORE_CURRENT_NOT_FOUND');
        this.blobs = new Map(Object.entries(snapshot.blobs));
        this.current = snapshot.current;
    }
}
function cloneGeneration(generation) { return structuredClone(generation); }
function registerBlobIn(blobs, body) {
    const hash = createHash('sha256').update(body, 'utf8').digest('hex');
    const existing = blobs.get(hash);
    if (existing !== undefined && existing !== body)
        throw new Error('KNOWLEDGE_BLOB_HASH_COLLISION');
    blobs.set(hash, body);
    return hash;
}
export function makeSourceRef(sourceId, body, observedVersion = 'unknown', readerSchemaHash = 'unknown') {
    const storedContentHash = createHash('sha256').update(body, 'utf8').digest('hex');
    return { sourceId, storedContentHash, observedVersion, readerSchemaHash, accessScope: 'local' };
}
//# sourceMappingURL=knowledgeStore.js.map