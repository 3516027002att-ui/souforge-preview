import { createHash } from 'node:crypto';
import { makeSourceRef } from './knowledgeStore.js';
export function buildKnowledgePatch(store, input) {
    const source = makeSourceRef(input.sourceId, input.body, input.observedVersion, input.readerSchemaHash);
    const current = store.getCurrent();
    const existing = current.pages[input.page.pageId];
    return {
        expectedGeneration: current.generationId,
        sourceRevisions: [source],
        pages: [{
                pageId: input.page.pageId,
                path: input.page.path,
                body: input.page.body,
                expectedRevision: existing?.revision ?? null,
                scope: input.page.scope,
                ...(input.page.claims ? { claims: input.page.claims } : {})
            }],
        ...(input.page.claims ? { claims: input.page.claims } : {})
    };
}
export function ingestKnowledgeSource(store, input) {
    const sourceHash = createHash('sha256').update(input.body, 'utf8').digest('hex');
    if (store.sourceRevision(input.sourceId) === sourceHash)
        return { ok: true, generation: store.getCurrent() };
    return store.commitPatch(buildKnowledgePatch(store, input));
}
export function sanitizeKnowledgeText(text) {
    return text.replace(/(?:^|\n)\s*(?:powershell|cmd|exec|writeFile)\b[^\n]*/giu, '$1[executable instruction removed by host]');
}
//# sourceMappingURL=knowledgeIngest.js.map