/**
 * Provider registry（T08，执行指令 §T08 步骤 5）。
 *
 * 把各 provider 注册为可按 source 组合的分片生产者：服务查询 current 的
 * source-scoped 关联分片，缺失分片通过这里补齐；同一 source/version 的构建
 * 任务合并（缓存键含 outerFileHash，版本变化自然失效）。
 *
 * 分片是否持久化沿用现有索引存储能力；本 registry 不做独立图数据库，也不把
 * 未校验的持久化投影直接当 current。
 */
import type { Diagnostic, ReferenceEdge, SymbolBundle } from '@soulforge/shared';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
import type { ResourceKind } from '@soulforge/shared';
export interface ProviderBuildOptions {
    includeHypotheses?: boolean;
    registry?: EmedfRegistry;
    enableNumericFallback?: boolean;
    maxAmbiguousNumericMatches?: number;
}
export interface ProviderShard {
    edges: ReferenceEdge[];
    diagnostics: Diagnostic[];
    /** EMEVD numeric-fallback suppression count (surfaced in graph stats). */
    suppressedAmbiguousNumbers?: number;
}
export interface ReferenceProviderDescriptor {
    id: string;
    /** ResourceKind domains this provider contributes edges for. */
    domains: readonly ResourceKind[];
    build: (bundle: SymbolBundle, options: ProviderBuildOptions) => ProviderShard;
}
export declare function buildNameMatchEdges(bundle: SymbolBundle): ProviderShard;
export declare const REFERENCE_PROVIDERS: readonly ReferenceProviderDescriptor[];
/** Providers whose domains include the given ResourceKind. */
export declare function providersForDomain(domain: ResourceKind): ReferenceProviderDescriptor[];
/** Capability entry for a domain; throws on unregistered kinds (exhaustive). */
export declare function capabilityForDomain(domain: ResourceKind): import("./referenceCapabilityRegistry.js").ReferenceDomainCapability;
