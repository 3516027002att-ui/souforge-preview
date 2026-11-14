/**
 * SoulForge 审计与执行合同 (Audit Execution Contracts)
 *
 * 依据：《SoulForge 全域审查与演进研究报告》与执行施工图 §0.7 / §0.8。
 * 提供全局统一的资源身份、版本指纹、规范序列化、统一错误码与事务结果合同。
 */
export function checkCondition(condition, code) {
    if (!condition) {
        const error = new Error(code);
        error.code = code;
        throw error;
    }
}
export function assertValidInteger(n, min = 0, max = Number.MAX_SAFE_INTEGER) {
    checkCondition(typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max, 'INVALID_INTEGER');
    return n;
}
export function assertNonEmptyString(s, fieldName = 'IDENTITY') {
    checkCondition(typeof s === 'string' && s.length > 0, `EMPTY_${fieldName}`);
    return s;
}
export function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * 规范稳定 JSON 序列化器。
 * 1. 严格排斥非有限数值 (NaN / Infinity)；
 * 2. 对象 Key 字母序稳定排序；
 * 3. 严格检测并拒绝循环引用；
 * 4. 仅支持普通对象、数组与基本标量。
 */
export function stableJson(value) {
    const ancestors = new Set();
    function visit(v) {
        if (v === null || typeof v === 'string' || typeof v === 'boolean') {
            return JSON.stringify(v);
        }
        if (typeof v === 'number') {
            checkCondition(Number.isFinite(v), 'NONFINITE_JSON');
            return JSON.stringify(v);
        }
        checkCondition(typeof v === 'object' && v !== null, 'UNSUPPORTED_JSON');
        checkCondition(!ancestors.has(v), 'CYCLIC_JSON');
        ancestors.add(v);
        let out;
        if (Array.isArray(v)) {
            out = '[' + v.map(visit).join(',') + ']';
        }
        else {
            const proto = Object.getPrototypeOf(v);
            checkCondition(proto === Object.prototype || proto === null, 'NONPLAIN_JSON');
            const keys = Object.keys(v).sort(compareText);
            out = '{' + keys.map((k) => JSON.stringify(k) + ':' + visit(v[k])).join(',') + '}';
        }
        ancestors.delete(v);
        return out;
    }
    return visit(value);
}
export function validateResourceIdentity(identity) {
    assertNonEmptyString(identity.workspaceId, 'WORKSPACE_ID');
    assertNonEmptyString(identity.canonicalOuterId, 'OUTER_ID');
    assertNonEmptyString(identity.formatProfileId, 'FORMAT_PROFILE_ID');
    checkCondition(Array.isArray(identity.childChain) && identity.childChain.every((x) => typeof x === 'string' && x.length > 0), 'INVALID_CHILD_CHAIN');
}
export function resourceIdentityKey(identity) {
    validateResourceIdentity(identity);
    return stableJson([
        identity.workspaceId,
        identity.canonicalOuterId,
        identity.childChain,
        identity.formatProfileId
    ]);
}
export function validateObjectIdentity(identity) {
    validateResourceIdentity(identity);
    assertNonEmptyString(identity.domain, 'DOMAIN');
    assertNonEmptyString(identity.namespace, 'NAMESPACE');
    assertNonEmptyString(identity.snapshotObjectHandle, 'OBJECT_HANDLE');
}
export function objectIdentityKey(identity) {
    validateObjectIdentity(identity);
    return stableJson([
        identity.workspaceId,
        identity.canonicalOuterId,
        identity.childChain,
        identity.formatProfileId,
        identity.domain,
        identity.namespace,
        identity.snapshotObjectHandle
    ]);
}
export function validateClaimIdentity(identity) {
    validateObjectIdentity(identity);
    assertNonEmptyString(identity.propertyKey, 'PROPERTY_KEY');
}
export function claimIdentityKey(identity) {
    validateClaimIdentity(identity);
    return stableJson([
        identity.workspaceId,
        identity.canonicalOuterId,
        identity.childChain,
        identity.formatProfileId,
        identity.domain,
        identity.namespace,
        identity.snapshotObjectHandle,
        identity.propertyKey
    ]);
}
export function snapshotVersionKey(version) {
    assertNonEmptyString(version.outerHash, 'OUTER_HASH');
    assertNonEmptyString(version.readerSchemaHash, 'READER_SCHEMA_HASH');
    assertNonEmptyString(version.metadataSchemaHash, 'METADATA_SCHEMA_HASH');
    assertValidInteger(version.workspaceEpoch, 0);
    return stableJson([
        version.outerHash,
        version.payloadHash ?? null,
        version.readerSchemaHash,
        version.metadataSchemaHash,
        version.workspaceEpoch
    ]);
}
export function confirmationReceiptKey(receipt) {
    assertNonEmptyString(receipt.workspaceId, 'WORKSPACE_ID');
    assertNonEmptyString(receipt.planHash, 'PLAN_HASH');
    assertValidInteger(receipt.maxModifications, 1);
    assertValidInteger(receipt.expiresAt, 0);
    checkCondition(Array.isArray(receipt.targetSet), 'INVALID_TARGET_SET');
    checkCondition(Array.isArray(receipt.allowedOperations), 'INVALID_ALLOWED_OPERATIONS');
    return stableJson({
        workspaceId: receipt.workspaceId,
        planHash: receipt.planHash,
        targetSet: receipt.targetSet,
        allowedOperations: receipt.allowedOperations,
        maxModifications: receipt.maxModifications,
        expiresAt: receipt.expiresAt,
        authorizationMode: receipt.authorizationMode
    });
}
// ---------------------------------------------------------------------------
// 0.8 统一错误与结果形状
// ---------------------------------------------------------------------------
export const AUDIT_EXECUTION_ERROR_CODES = [
    'INVALID_INPUT',
    'UNSUPPORTED_CAPABILITY',
    'STALE_SNAPSHOT',
    'AMBIGUOUS_TARGET',
    'INCOMPLETE_COVERAGE',
    'PRECONDITION_FAILED',
    'VALIDATION_FAILED',
    'COMMIT_FAILED',
    'RECOVERY_REQUIRED',
    'CANCELLED_BEFORE_COMMIT',
    'COMMITTED_BUT_NOT_VERIFIED',
    'ENVIRONMENT_BLOCKED'
];
export function isAuditExecutionErrorCode(code) {
    return AUDIT_EXECUTION_ERROR_CODES.includes(code);
}
export function validateTextEntryHandle(handle) {
    assertNonEmptyString(handle.workspaceId, 'WORKSPACE_ID');
    assertNonEmptyString(handle.outerId, 'OUTER_ID');
    assertValidInteger(handle.childIndex, 0);
    assertNonEmptyString(handle.expectedChildHash, 'CHILD_HASH');
    assertNonEmptyString(handle.language, 'LANGUAGE');
    assertNonEmptyString(handle.category, 'CATEGORY');
    assertValidInteger(handle.slotIndex, 0);
    assertValidInteger(handle.expectedTextId, 0);
    checkCondition((typeof handle.sourceVersion === 'number' && Number.isFinite(handle.sourceVersion)) ||
        (typeof handle.sourceVersion === 'string' && handle.sourceVersion.length > 0), 'INVALID_SOURCE_VERSION');
}
export function textEntryHandleKey(handle) {
    validateTextEntryHandle(handle);
    return `${handle.workspaceId}::${handle.outerId}::${handle.childIndex}::${handle.language}::${handle.category}::${handle.slotIndex}::${handle.expectedTextId}`;
}
export function validateEventHandle(handle) {
    assertNonEmptyString(handle.fileUri, 'FILE_URI');
    assertNonEmptyString(handle.eventId, 'EVENT_ID');
    // 事件 ID 字符串必须表示合法的安全非负整数
    checkCondition(/^\d{1,16}$/.test(handle.eventId), 'INVALID_EVENT_ID_FORMAT');
    const numericId = Number(handle.eventId);
    checkCondition(Number.isSafeInteger(numericId) && numericId >= 0, 'EVENT_ID_OUT_OF_SAFE_RANGE');
    checkCondition((typeof handle.sourceVersion === 'number' && Number.isFinite(handle.sourceVersion)) ||
        (typeof handle.sourceVersion === 'string' && handle.sourceVersion.length > 0), 'INVALID_SOURCE_VERSION');
}
export function eventHandleKey(handle) {
    validateEventHandle(handle);
    return `${handle.fileUri}::event:${handle.eventId}`;
}
export function validateInstructionHandle(handle) {
    assertNonEmptyString(handle.eventHandleKey, 'EVENT_HANDLE_KEY');
    assertValidInteger(handle.localOrdinal, 0);
    assertNonEmptyString(handle.instructionHash, 'INSTRUCTION_HASH');
    assertNonEmptyString(handle.id, 'INSTRUCTION_HANDLE_ID');
    checkCondition((typeof handle.sourceVersion === 'number' && Number.isFinite(handle.sourceVersion)) ||
        (typeof handle.sourceVersion === 'string' && handle.sourceVersion.length > 0), 'INVALID_SOURCE_VERSION');
}
export function instructionHandleKey(handle) {
    validateInstructionHandle(handle);
    return handle.id;
}
export function validateParameterBinding(binding) {
    assertNonEmptyString(binding.id, 'BINDING_ID');
    assertNonEmptyString(binding.eventHandleKey, 'EVENT_HANDLE_KEY');
    assertNonEmptyString(binding.targetInstructionHandleId, 'TARGET_INSTRUCTION_HANDLE_ID');
    assertValidInteger(binding.targetByteOffset, 0);
    assertValidInteger(binding.byteCount, 1);
    assertValidInteger(binding.sourceStartByte, 0);
    assertValidInteger(binding.unkId, 0);
}
export function parameterBindingKey(binding) {
    validateParameterBinding(binding);
    return `${binding.eventHandleKey}::bind:${binding.id}`;
}
export function validateTaeEventHandle(handle) {
    assertNonEmptyString(handle.fileUri, 'FILE_URI');
    assertValidInteger(handle.animId, 0);
    assertValidInteger(handle.originalEventIndex, 0);
    assertValidInteger(handle.eventTypeId, 0);
    assertNonEmptyString(handle.paramDataHash, 'PARAM_DATA_HASH');
    checkCondition((typeof handle.sourceVersion === 'number' && Number.isFinite(handle.sourceVersion)) ||
        (typeof handle.sourceVersion === 'string' && handle.sourceVersion.length > 0), 'INVALID_SOURCE_VERSION');
}
export function taeEventHandleKey(handle) {
    validateTaeEventHandle(handle);
    return `${handle.fileUri}::anim:${handle.animId}::event:${handle.originalEventIndex}`;
}
//# sourceMappingURL=audit-execution-contracts.js.map