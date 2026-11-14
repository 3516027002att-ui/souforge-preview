/**
 * SF-12 ChangeSetPlan
 *
 * 冻结计划规范与后置条件判定契约：
 * 1. 计划、候选产物阶段与最终落盘分离。
 * 2. readSet 包含规范资源 URI/版本/模式定义；writeSet 以最终 outer 目标为单位（同 outer 聚合）。
 * 3. expectedPostconditions 必须可由程序读取校验（文本/字段/实体属性/哈希）。
 * 4. 计划哈希严格确定性计算，保证授权与入锁核验一致。
 */
import type { Diagnostic } from '@soulforge/shared';
export interface ChangeSetReadItem {
    canonicalUri: string;
    canonicalPath?: string;
    version?: string | number;
    hash?: string;
    schemaOrKind?: string;
}
export interface ChangeSetWriteItem {
    canonicalOuterUri: string;
    canonicalOuterPath: string;
    targetKind?: string;
    expectedBeforeHash?: string;
    beforeExists?: boolean;
    expectedAfterHash?: string;
    afterExists?: boolean;
}
export interface ChangeSetOperation {
    id: string;
    targetOuterUri: string;
    targetOuterPath: string;
    childIdentifier?: {
        index?: number;
        id?: number;
        name?: string;
        hash?: string;
        leafFormat?: string;
    };
    domain: string;
    kind: string;
    payload: unknown;
}
export interface ChangeSetCandidate {
    operationId: string;
    artifactHandle: string;
    targetOuterPath: string;
    sourceVersion: string;
    payloadHash: string;
    bytes: number;
    writerVerificationInfo?: Record<string, unknown>;
}
export interface FrozenVersionCheck {
    canonicalUri: string;
    expectedVersion?: string | number;
    expectedHash?: string;
    actualVersion?: string | number;
    actualHash?: string;
}
export type ChangeSetPostcondition = {
    type: 'text_entry_equals';
    description?: string;
    handle?: string;
    containerUri?: string;
    category?: string;
    entryId?: number;
    expectedText: string;
} | {
    type: 'param_field_equals';
    description?: string;
    paramName: string;
    rowId: number;
    fieldName: string;
    expectedValue: unknown;
} | {
    type: 'msb_part_property_equals';
    description?: string;
    mapId: string;
    partName: string;
    property: string;
    expectedValue: unknown;
} | {
    type: 'file_hash_equals';
    description?: string;
    targetPath: string;
    expectedHash: string;
} | {
    type: 'custom_check';
    checkId: string;
    description: string;
    expectedState?: unknown;
};
export interface ChangeSetPlan {
    planId: string;
    workspaceId: string;
    baseSnapshot: {
        snapshotId?: string;
        rootHash?: string;
        capturedAt: string;
        [key: string]: unknown;
    };
    readSet: ChangeSetReadItem[];
    writeSet: ChangeSetWriteItem[];
    orderedOperations: ChangeSetOperation[];
    expectedPostconditions: ChangeSetPostcondition[];
    requiredCapabilities: string[];
    expectedChangedObjectCount: number;
    planHash: string;
    approvalReceiptId?: string;
    idempotencyKey?: string;
    createdAt: string;
}
export interface CreateChangeSetPlanInput {
    planId?: string;
    workspaceId: string;
    baseSnapshot?: {
        snapshotId?: string;
        rootHash?: string;
        capturedAt?: string;
        [key: string]: unknown;
    };
    readSet: ChangeSetReadItem[];
    writeSet: ChangeSetWriteItem[];
    orderedOperations: ChangeSetOperation[];
    expectedPostconditions?: ChangeSetPostcondition[];
    requiredCapabilities?: string[];
    expectedChangedObjectCount?: number;
    approvalReceiptId?: string;
    idempotencyKey?: string;
    createdAt?: string;
}
/**
 * 确定性计算 ChangeSetPlan 规范哈希
 */
export declare function computeChangeSetPlanHash(plan: Omit<ChangeSetPlan, 'planHash'>): string;
/**
 * 构造并冻结 ChangeSetPlan。
 * 强制检查：同 outer 聚合，writeSet 中每个 outer 文件绝对路径只能出现一次。
 */
export declare function createChangeSetPlan(input: CreateChangeSetPlanInput): ChangeSetPlan;
/**
 * 校验 ChangeSetPlan 完整性与哈希一致性
 */
export declare function validateChangeSetPlan(plan: ChangeSetPlan): {
    ok: boolean;
    diagnostics: Diagnostic[];
};
/** Operations are simulated per child, but committed once per outer. */
export declare function groupChangeSetOperationsByOuter(plan: Pick<ChangeSetPlan, 'orderedOperations'>): Map<string, ChangeSetOperation[]>;
/**
 * Re-check every frozen read item at the write boundary. No item may be silently
 * rebased to a newer source version after approval.
 */
export declare function validateFrozenReadSet(plan: Pick<ChangeSetPlan, 'readSet' | 'planHash'>, actual: readonly FrozenVersionCheck[]): {
    ok: boolean;
    code?: 'STALE_PLAN' | 'READ_SET_MISSING';
    mismatches: FrozenVersionCheck[];
};
export declare function validateCandidatesForPlan(plan: Pick<ChangeSetPlan, 'orderedOperations' | 'writeSet'>, candidates: readonly ChangeSetCandidate[]): {
    ok: boolean;
    diagnostics: Diagnostic[];
};
export interface PostconditionEvaluator {
    readTextEntry?(handle: string | {
        containerUri?: string;
        category?: string;
        entryId?: number;
    }): Promise<string | undefined>;
    readParamField?(paramName: string, rowId: number, fieldName: string): Promise<unknown>;
    readMsbPartProperty?(mapId: string, partName: string, property: string): Promise<unknown>;
    readFileHash?(targetPath: string): Promise<string | undefined>;
    runCustomCheck?(checkId: string, expectedState?: unknown): Promise<{
        ok: boolean;
        message?: string;
    }>;
}
/**
 * 校验程序化预期后置条件
 */
export declare function evaluatePostconditions(postconditions: readonly ChangeSetPostcondition[], evaluator: PostconditionEvaluator): Promise<{
    ok: boolean;
    diagnostics: Diagnostic[];
}>;
