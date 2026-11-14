import { createRagChunkExclusionMask } from './retrieve.js';
// A native refresh can leave a durable corpus containing both the old and the
// newly read rows for one physical source.  Keep the expensive provenance
// comparison at the host boundary and reuse it for every retrieval in the
// same (index, corpus, native epoch) snapshot.
const masksByIndex = new WeakMap();
export function getRagStaleChunkIdsCached(index, corpus) {
    return getRagStaleChunkMaskCached(index, corpus)?.ids ?? [];
}
export function getRagStaleChunkMaskCached(index, corpus) {
    const epoch = index.getNativeVersionEpoch();
    let byCorpus = masksByIndex.get(index);
    if (!byCorpus) {
        byCorpus = new WeakMap();
        masksByIndex.set(index, byCorpus);
    }
    const cached = byCorpus.get(corpus);
    if (cached?.epoch === epoch)
        return cached.mask;
    const chunkIds = index.getRagStaleChunkIds(corpus.chunks);
    const mask = chunkIds.length > 0 ? createRagChunkExclusionMask(chunkIds) : undefined;
    byCorpus.set(corpus, { epoch, mask });
    return mask;
}
//# sourceMappingURL=freshness.js.map