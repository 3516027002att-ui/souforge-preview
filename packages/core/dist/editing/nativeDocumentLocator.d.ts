/**
 * NATIVE-03: Bridge-confirmed native document locator（§14.4 core-internal）。
 *
 * core 内部专用，绝不通过 shared/preload 导出：locator 携带 main-only 的
 * outerSourceUri，renderer 永远只消费 opaque document handle。
 *
 * 本模块只解释 Bridge probe 返回的脱敏结果（bridge-protocol.ts 的
 * BridgeDocumentLocatorValue）；suffix/path hint 永远不能构造层。冲突
 * （同一 child 两个不兼容 confirmed leaf）必须失败关闭，禁止静默单选。
 */
import type { BridgeDocumentLocatorValue, ContainerRole, NativeFormatId } from '@soulforge/shared';
export interface NativeDocumentLocatorLayer {
    readonly layerIndex: number;
    readonly formatId: Exclude<NativeFormatId, 'unknown'>;
    readonly entry: null | {
        readonly parentLayerIndex: number;
        readonly stableEntryId: string;
        readonly entryIndex: number;
        readonly entryName: string;
        readonly expectedEntryHash: string;
    };
}
export interface NativeDocumentLocator {
    readonly locatorId: string;
    readonly outerResourceId: string;
    readonly outerSourceUri: string;
    readonly sourceVariant: 'overlay' | 'base';
    readonly expectedOuterRevision: string;
    readonly expectedOuterHash: string;
    readonly containerRole: ContainerRole;
    readonly layers: readonly NativeDocumentLocatorLayer[];
    readonly leafDocumentStableId: string;
}
export type LocatorProbeOutcome = {
    kind: 'confirmed';
    locator: NativeDocumentLocator;
} | {
    kind: 'blocked';
    reasonCode: 'compression-runtime-unavailable' | 'bridge-runtime-unavailable';
    bridgeMessage: string | null;
} | {
    kind: 'unsupported';
    reasonCode: string;
} | {
    kind: 'conflict';
    confirmedStackIds: readonly string[];
};
export interface BuildNativeDocumentLocatorInput {
    readonly outerResourceId: string;
    readonly outerSourceUri: string;
    readonly sourceVariant: 'overlay' | 'base';
    readonly expectedOuterRevision: string;
    readonly bridgeValue: BridgeDocumentLocatorValue;
}
/**
 * 只把 Bridge-confirmed 层组装进 locator；`unknown` 层不得成为 confirmed
 * format。probe 已判 conflict/blocked 时失败关闭，不静默单选。
 */
export declare function buildNativeDocumentLocator(input: BuildNativeDocumentLocatorInput): LocatorProbeOutcome;
