/**
 * 一份「集合型对象」读取实际交付的连续切片。
 *
 * 集合型对象指「整份文件的事件 id 集合」（EMEVD outline）、「整张表的物理行集合」（PARAM）
 * 和「整张表的条目集合」（FMG）。这些读一次只交付一段，证明必须记住这一段覆盖的索引区间，
 * 才能把「翻完全部页」与「一次读完」判成同一件事，而不是让任意一页（哪怕只读了 256 条事件、
 * 128 行、64 条目）都冒充整个集合。区间是半开区间 [startIndex, endIndex)。
 */
export interface HostDeliveredItemRange {
    startIndex: number;
    endIndex: number;
    totalItems: number;
    /** 这次调用的页宽；只用于把缺口语义化地标成「第 N–M 页」。 */
    pageSize?: number;
}
export interface HostDeliveredNativeRead {
    principal: string;
    workspaceId: string;
    /** 精确对象稳定键（不丢失 child identity）。 */
    objectKey: string;
    outerSourceKey: string;
    version: {
        outerFileHash?: string;
        childHash?: string;
        sourceRevision?: number;
        generation?: number;
    };
    /** 最终 envelope 中实际保留的原生字段/范围。 */
    deliveredFields?: string[];
    deliveredTextRange?: {
        startByte: number;
        endByte: number;
        totalUtf8Bytes: number;
        fullTextHash: string;
    };
    /** 集合型对象的分页交付切片（EMEVD outline / PARAM 行枚举 / FMG 条目枚举）。 */
    deliveredItemRanges?: HostDeliveredItemRange[];
    readShape: 'fields' | 'full-event' | 'full-script' | 'window' | 'fragment';
    capability?: string;
}
export interface HostWriteRequirement {
    principal: string;
    workspaceId: string;
    objectKey: string;
    outerSourceKey: string;
    version: {
        outerFileHash?: string;
        childHash?: string;
        sourceRevision?: number;
        generation?: number;
    };
    requiredFields?: string[];
    requiredShape?: 'fields' | 'full-event' | 'full-script';
    requiredTextRange?: {
        startByte: number;
        endByte: number;
    };
    /**
     * 要求整个集合 （EMEVD 事件 id / PARAM 表行 / FMG 表条目）都已交付。
     *
     * 新建事件、新建 PARAM 行、新增 FMG 条目都没有既有条目可读，能证明的只有「整个集合被
     * 观察过」：单页只覆盖一个切片，而新建需要调用方看到「哪些 id/行已被占用」，所以要求
     * 页并集覆盖 [0, total)。缺页即失败关闭。
     */
    requiredItemSet?: boolean;
}
export interface ValidatedNativeReadProof {
    objectKey: string;
    outerSourceKey: string;
    version: {
        outerFileHash?: string;
        childHash?: string;
        sourceRevision?: number;
        generation?: number;
    };
    coveredFields: string[];
}
export declare class ProofError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export interface NativeReadProofStore {
    acceptDeliveredRead(input: HostDeliveredNativeRead): void;
    requireCoverage(input: HostWriteRequirement): ValidatedNativeReadProof;
    invalidateSource(sourceKey: string, generation: number): void;
    /**
     * 只让该外层源里匹配 predicate 的证明过期（其它子表 / 其它 TAE 段的证明保持有效）。
     *
     * 写一个 PARAM 子表只改变那个子项的字节：把同容器其它子表的读证明一并作废，会让
     * 「读 A → 写 B → 写 A」这种正常流程无谓地失败。TAE 同理：写一个段不影响另一个段的词条。
     */
    invalidateSourceWhere(sourceKey: string, generation: number, matches: (objectKey: string) => boolean): void;
    invalidateAll(reason: string): void;
    dispose(): void;
}
export declare function createNativeReadProofStore(): NativeReadProofStore;
