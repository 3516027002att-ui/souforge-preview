import { ALL_RESOURCE_KINDS, KNOWN_RESOURCE_DIRS, type ArtifactMarkers, type ResourceKind } from '@soulforge/shared';
import type { IndexedFile } from '@soulforge/shared';
export { ALL_RESOURCE_KINDS, KNOWN_RESOURCE_DIRS };
/**
 * CAT-05 扫描期 artifact 基础标记（§4.3）。
 *
 * 只做可机械判定的部分：大小写不敏感的 `.bak`/`.prev` 后缀、`sourceLayer`
 * 来源层、projection sidecar 的 provenance digest（调用方解析 manifest 后
 * 传入）。不解释语义——`editorCatalog.ts` 套 §4.4 注册表决定分类，且本函数
 * 不改变现有物理 `ResourceKind`。
 */
export declare function detectArtifactMarkers(input: {
    relativePath: string;
    sourceLayer: 'overlay' | 'base';
    recoveryOfResourceId?: string;
    projectionProvenanceDigest?: string;
}): ArtifactMarkers | undefined;
export declare function classifyResourceKind(relativePath: string): ResourceKind;
export declare function isKnownResourceKind(value: string): value is ResourceKind;
/**
 * Semantic/native readers must not treat recovery artifacts as live game
 * resources.  Keep the files in the catalog for History/restore UI, but make
 * the default analysis domain a hard primary/base-only filter.
 */
export declare function isActiveSemanticSource(file: Pick<IndexedFile, 'relativePath' | 'artifactMarkers'>): boolean;
