/** T11-D 批量调用：有序、依赖失败跳过、逐项结果；不是跨资源全局事务。 */
export interface BatchItem {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    dependsOn?: string[];
}
export type BatchItemStatus = 'success' | 'failed' | 'skipped_dependency';
export interface BatchItemResult {
    id: string;
    status: BatchItemStatus;
    result?: unknown;
    error?: string;
}
export interface BatchOutcome {
    results: BatchItemResult[];
    succeeded: number;
    failed: number;
    skipped: number;
}
export declare function validateBatch(items: BatchItem[]): void;
export declare function executeBatch(items: BatchItem[], call: (item: BatchItem) => Promise<unknown>, options?: {
    continueOnError?: boolean;
}): Promise<BatchOutcome>;
