/**
 * CAT-05: EditorCatalog builder（§4.3 识别优先级 + §4.4 固定注册表）。
 *
 * 本模块只解释 packages/shared/src/editor-catalog.ts 的注册表
 * （ARTIFACT_ROLE_RULES / RESOURCE_CLASSIFICATION_RULES），不得另建自由分支：
 *
 *   1000 artifact role → history / projection / hidden（不再进入普通领域）
 *    900 Bridge-confirmed leaf → catalog 文档
 *    800 confirmed container child → 投影文档（与容器文档共存）
 *    600 compound suffix → Files candidate
 *    300 path hint / 0 Files fallback
 *
 * 输入：物理索引 + artifact 标记（scanner 产出）+ Bridge-confirmed 格式栈
 * （调用方 probe）+ projection manifest（调用方解析 sidecar）+ capability
 * 快照（调用方提供）。本模块不调用 renderer helper。
 *
 * overlay 与 base 是同一逻辑资源的 source variants：按 relativePath 合并为
 * 一个 CatalogDocument，effective variant 先比较 sourceLayer（overlay 高于
 * base，history 永不成为 effective），再比较 precedence；同层同 precedence
 * 但 hash 不同 → conflict，禁止按扫描顺序取最后一个。
 */
import type { ConfirmedFormatStack, ContainerRole, EditorCatalogSnapshot, EditorCatalogSummary, OperationCapability } from '@soulforge/shared';
import type { IndexedFile } from '@soulforge/shared';
export interface ProjectionManifest {
    readonly nativeResourceId: string;
    readonly nativeSourceRevision: string;
    readonly nativeSourceHash: string;
    readonly provenanceDigest: string;
}
export interface BuildEditorCatalogInput {
    readonly files: readonly IndexedFile[];
    /** Bridge-confirmed 格式栈，key = sourceUri（overlay 物理文件）。 */
    readonly confirmedStacks?: ReadonlyMap<string, ConfirmedFormatStack>;
    /** projection sidecar 的 manifest，key = sidecar sourceUri。 */
    readonly projectionManifests?: ReadonlyMap<string, ProjectionManifest>;
    /** 已登记 recovery 关联（operation log 等权威来源），key = 备份文件 sourceUri。 */
    readonly registeredRecoveries?: ReadonlyMap<string, string>;
    /** 读能力快照，key = sourceUri；缺省按 read-contract-missing blocked（不伪造）。 */
    readonly capabilitySnapshot?: ReadonlyMap<string, OperationCapability>;
    readonly catalogRevision?: string;
}
export declare function buildEditorCatalog(input: BuildEditorCatalogInput): EditorCatalogSnapshot;
export declare function buildEditorCatalogSummary(snapshot: EditorCatalogSnapshot): EditorCatalogSummary;
/** 已确认 stack 的 child 层投影（§4.3 800：confirmed container child 与容器文档共存）。 */
export declare function collectConfirmedChildProjections(stack: ConfirmedFormatStack): Array<{
    childStableId: string;
    formatId: string;
    parentRole: ContainerRole;
}>;
