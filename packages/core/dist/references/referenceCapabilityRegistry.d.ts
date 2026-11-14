/**
 * 资源关联能力 registry（T07，执行指令 §T07 步骤 11/12）。
 *
 * 为每一种 `ResourceKind` 登记**关联语义**能力：supported / partial /
 * unsupported、支持的 relation kinds、原生 reader、未覆盖原因。
 *
 * 这不是编辑器读写能力矩阵（那是 `capabilities/resourceCapabilities.ts`，
 * 按文件/格式计算读写与容器级别）；本 registry 只回答"关联图能不能在该域
 * 产生有依据的边、边从哪里来"。两者互不改写。
 *
 * 穷举保证：`REFERENCE_CAPABILITIES` 以 `ALL_RESOURCE_KINDS` 为键做编译期
 * 穷举（Record 类型）+ 运行期 registry 测试；新增值缺登记即失败（步骤 12）。
 */
import { type ReferenceRelationKind, type ResourceKind } from '@soulforge/shared';
export type ReferenceCapabilityStatus = 'supported' | 'partial' | 'unsupported';
export interface ReferenceDomainCapability {
    kind: ResourceKind;
    status: ReferenceCapabilityStatus;
    /** Relation kinds this domain can currently produce with native evidence. */
    relationKinds: readonly ReferenceRelationKind[];
    /** Native reader / provider that produces the semantic projection. */
    reader: string;
    /** Provider module implementing the edges for this domain. */
    provider: string;
    /** Why coverage is partial/unsupported; empty only when supported. */
    uncoveredReasons: readonly string[];
}
/**
 * 按 `ResourceKind` 登记：param/event(emevd)/msg(fmg)/script/map 为核心支持域；
 * action(TAE/ANIBND)、ai、menu 为 partial；chr/obj/sfx/other/unknown 目前
 * 只有容器/文件级投影，关联语义登记为 unsupported 并写明缺口，不冒充
 * "已解析"。TAE 子项身份归入 action 域（ResourceKind 没有独立的 tae 值）。
 */
export declare const REFERENCE_CAPABILITIES: Readonly<Record<ResourceKind, ReferenceDomainCapability>>;
/**
 * 穷举自检：`ALL_RESOURCE_KINDS` 的每一个值都必须有登记；反向，registry 里
 * 不得出现枚举外的键。测试入口调用它，新增 kind 缺登记即失败（步骤 12）。
 */
export declare function validateReferenceCapabilities(): {
    ok: true;
} | {
    ok: false;
    missing: string[];
    extra: string[];
};
export declare function referenceCapabilityFor(kind: ResourceKind): ReferenceDomainCapability;
