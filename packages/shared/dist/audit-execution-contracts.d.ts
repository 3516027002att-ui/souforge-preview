/**
 * SoulForge 审计与执行合同 (Audit Execution Contracts)
 *
 * 依据：《SoulForge 全域审查与演进研究报告》与执行施工图 §0.7 / §0.8。
 * 提供全局统一的资源身份、版本指纹、规范序列化、统一错误码与事务结果合同。
 */
export declare function checkCondition(condition: boolean, code: string): asserts condition;
export declare function assertValidInteger(n: unknown, min?: number, max?: number): number;
export declare function assertNonEmptyString(s: unknown, fieldName?: string): string;
export declare function compareText(a: string, b: string): number;
/**
 * 规范稳定 JSON 序列化器。
 * 1. 严格排斥非有限数值 (NaN / Infinity)；
 * 2. 对象 Key 字母序稳定排序；
 * 3. 严格检测并拒绝循环引用；
 * 4. 仅支持普通对象、数组与基本标量。
 */
export declare function stableJson(value: unknown): string;
export interface ResourceIdentity {
    readonly workspaceId: string;
    readonly canonicalOuterId: string;
    readonly childChain: readonly string[];
    readonly formatProfileId: string;
}
export interface ObjectIdentity extends ResourceIdentity {
    readonly domain: string;
    readonly namespace: string;
    readonly snapshotObjectHandle: string;
}
export interface ClaimIdentity extends ObjectIdentity {
    readonly propertyKey: string;
}
export declare function validateResourceIdentity(identity: ResourceIdentity): void;
export declare function resourceIdentityKey(identity: ResourceIdentity): string;
export declare function validateObjectIdentity(identity: ObjectIdentity): void;
export declare function objectIdentityKey(identity: ObjectIdentity): string;
export declare function validateClaimIdentity(identity: ClaimIdentity): void;
export declare function claimIdentityKey(identity: ClaimIdentity): string;
export interface SnapshotVersion {
    readonly outerHash: string;
    readonly payloadHash?: string | null;
    readonly readerSchemaHash: string;
    readonly metadataSchemaHash: string;
    readonly workspaceEpoch: number;
}
export declare function snapshotVersionKey(version: SnapshotVersion): string;
export interface AuditConfirmationReceipt {
    readonly workspaceId: string;
    readonly planHash: string;
    readonly targetSet: readonly string[];
    readonly allowedOperations: readonly string[];
    readonly maxModifications: number;
    readonly expiresAt: number;
    readonly authorizationMode: 'user_confirmed' | 'pre_authorized' | 'bypass';
}
export declare function confirmationReceiptKey(receipt: AuditConfirmationReceipt): string;
export declare const AUDIT_EXECUTION_ERROR_CODES: readonly ["INVALID_INPUT", "UNSUPPORTED_CAPABILITY", "STALE_SNAPSHOT", "AMBIGUOUS_TARGET", "INCOMPLETE_COVERAGE", "PRECONDITION_FAILED", "VALIDATION_FAILED", "COMMIT_FAILED", "RECOVERY_REQUIRED", "CANCELLED_BEFORE_COMMIT", "COMMITTED_BUT_NOT_VERIFIED", "ENVIRONMENT_BLOCKED"];
export type AuditExecutionErrorCode = (typeof AUDIT_EXECUTION_ERROR_CODES)[number];
export declare function isAuditExecutionErrorCode(code: string): code is AuditExecutionErrorCode;
export interface AuditExecutionDiagnostic {
    readonly severity: 'error' | 'warning' | 'info';
    readonly code: AuditExecutionErrorCode | string;
    readonly message: string;
    readonly target?: string;
}
export interface AuditExecutionResult<T = unknown> {
    readonly transactionId: string;
    readonly commitState: 'not_committed' | 'staged' | 'committed' | 'failed' | 'rolled_back';
    readonly verificationState: 'unverified' | 'verified_native' | 'verified_synthetic' | 'failed';
    readonly requestedTargets: readonly string[];
    readonly modifiedTargets: readonly string[];
    readonly unchangedTargets: readonly string[];
    readonly postconditions: readonly string[];
    readonly affectedVersions: readonly SnapshotVersion[];
    readonly diagnostics: readonly AuditExecutionDiagnostic[];
    readonly ok: boolean;
    readonly data?: T;
}
export interface TextEntryHandle {
    readonly workspaceId: string;
    readonly outerId: string;
    readonly childIndex: number;
    readonly expectedChildHash: string;
    readonly language: string;
    readonly category: string;
    readonly slotIndex: number;
    readonly expectedTextId: number;
    readonly sourceVersion: number | string;
}
export declare function validateTextEntryHandle(handle: TextEntryHandle): void;
export declare function textEntryHandleKey(handle: TextEntryHandle): string;
export interface EventHandle {
    readonly fileUri: string;
    /** 事件 ID 在 wire 上使用精确字符串 */
    readonly eventId: string;
    readonly sourceVersion: number | string;
}
export declare function validateEventHandle(handle: EventHandle): void;
export declare function eventHandleKey(handle: EventHandle): string;
export interface InstructionHandle {
    readonly eventHandleKey: string;
    /** 原始事件局部序号 (0-based) */
    readonly localOrdinal: number;
    /** 指令 hash (内容指纹) */
    readonly instructionHash: string;
    readonly sourceVersion: number | string;
    readonly id: string;
}
export declare function validateInstructionHandle(handle: InstructionHandle): void;
export declare function instructionHandleKey(handle: InstructionHandle): string;
export interface ParameterBinding {
    readonly id: string;
    readonly eventHandleKey: string;
    /** 目标指令句柄 ID (与具体局部序号解耦) */
    readonly targetInstructionHandleId: string;
    /** 目标指令参数体内的字节偏移量 (byteOffset) */
    readonly targetByteOffset: number;
    /** 字节宽度 (width) */
    readonly byteCount: number;
    /** 事件参数源字节偏移量 (sourceStartByte) */
    readonly sourceStartByte: number;
    readonly unkId: number;
}
export declare function validateParameterBinding(binding: ParameterBinding): void;
export declare function parameterBindingKey(binding: ParameterBinding): string;
export interface TaeEventHandle {
    readonly fileUri: string;
    readonly animId: number;
    readonly originalEventIndex: number;
    readonly eventTypeId: number;
    readonly paramDataHash: string;
    readonly sourceVersion: number | string;
}
export declare function validateTaeEventHandle(handle: TaeEventHandle): void;
export declare function taeEventHandleKey(handle: TaeEventHandle): string;
