import type { EventHandle, InstructionHandle, ParameterBinding } from '@soulforge/shared';
import type { EmevdEditorDocument } from '@soulforge/shared';
export interface SimulationInstruction {
    readonly handle: InstructionHandle;
    bank: number;
    id: number;
    args: Buffer;
    unknown: boolean;
    layerOffset?: number | undefined;
}
export interface SimulationParameter {
    readonly binding: ParameterBinding;
    targetInstructionHandleId: string;
    targetByteOffset: number;
    byteCount: number;
    sourceStartByte: number;
    unkId: number;
}
export interface SimulationEvent {
    readonly handle: EventHandle;
    currentId: string;
    restBehavior: number;
    instructions: SimulationInstruction[];
    parameters: SimulationParameter[];
}
export interface RelocationEntry {
    finalEventLocalOrdinal: number;
    finalGlobalOrdinal: number;
}
export interface ParameterRelocationEntry {
    finalInstructionIndex: number;
    targetByteOffset: number;
    byteCount: number;
    sourceStartByte: number;
    unkId: number;
}
export interface CompiledSimulationPlan {
    readonly events: Array<{
        eventId: number;
        restBehavior: number;
        instructions: Array<{
            bank: number;
            id: number;
            args: Buffer;
            unknown: boolean;
            layerOffset?: number | undefined;
        }>;
        parameters: Array<{
            instructionIndex: number;
            targetStartByte: number;
            sourceStartByte: number;
            byteCount: number;
            unkId: number;
        }>;
    }>;
    readonly eventIdMap: Map<string, number>;
    readonly instructionRelocationMap: Map<string, RelocationEntry>;
    readonly parameterRelocationMap: Map<string, ParameterRelocationEntry>;
    readonly bridgePatches: Array<Record<string, unknown>>;
    readonly stringBytes?: Buffer | undefined;
    readonly totalInstructions: number;
    readonly totalParameters: number;
}
export interface SimulationOracleSnapshot {
    eventCount: number;
    totalInstructions: number;
    totalParameters: number;
    events: Array<{
        id: number;
        restBehavior: number;
        instructionCount: number;
        parameterCount: number;
        instructionHashes: string[];
        parameters: Array<{
            instructionIndex: number;
            targetStartByte: number;
            byteCount: number;
        }>;
    }>;
}
/**
 * 纯模拟器 (EmevdMutationSimulator)
 * 依据 SF-09 §2.4.2 顺序模拟与符号重定位
 */
export declare class EmevdMutationSimulator {
    private readonly fileUri;
    private readonly sourceVersion;
    private readonly events;
    private stringBytes?;
    private nextInstructionSeq;
    private nextBindingSeq;
    constructor(fileUri: string, sourceVersion?: number | string);
    static fromDocument(doc: EmevdEditorDocument): EmevdMutationSimulator;
    static fromEvents(fileUri: string, sourceVersion: number | string, rawEvents: Array<{
        id: number | string;
        restBehavior: number;
        instructions: Array<{
            bank: number;
            id: number;
            args: Buffer;
            unknown?: boolean;
            layerOffset?: number;
        }>;
        parameters?: Array<{
            instructionIndex: number;
            targetStartByte: number;
            sourceStartByte: number;
            byteCount: number;
            unkId?: number;
        }>;
    }>): EmevdMutationSimulator;
    getEvents(): readonly SimulationEvent[];
    findEvent(eventHandleKeyOrId: string): SimulationEvent | undefined;
    /**
     * 顺序重命名单个事件
     * 规则：rename A→B，撞当前命名空间时直接拒绝（“普通顺序 rename 撞当前命名空间时拒绝”）
     */
    renameEvent(eventHandleKeyOrId: string, newId: string | number): void;
    /**
     * 批次同时重命名 (batch rename)
     * 规则：具有“同时命名语义”，允许原子交换 A 和 B；验证最终命名映射唯一，不允许多个存活事件撞同 ID。
     */
    batchRenameEvents(renames: Array<{
        eventHandleKeyOrId: string;
        newId: string | number;
    }>): void;
    /**
     * 插入指令
     * 规则：在事件内指定位置插入新指令；有序 InstructionHandle 列表更新；
     * 参数绑定继续指向原有 InstructionHandle，其 targetByteOffset 严格不变！
     */
    insertInstruction(eventHandleKeyOrId: string, atIndex: number, instruction: {
        bank: number;
        id: number;
        args: Buffer;
        unknown?: boolean;
        layerOffset?: number;
    }): InstructionHandle;
    /**
     * 删除指令
     * 规则：删除被参数绑定引用的指令默认拒绝，除非同计划包含明确的 binding 删除/重定向。
     */
    deleteInstruction(eventHandleKeyOrId: string, instructionHandleId: string, options?: {
        allowReferenced?: boolean;
    }): void;
    /**
     * 修改指令参数
     * 规则：涉及 opaque / unknown 节点的参数修改，在无 profile 时拒绝。
     */
    modifyInstructionArgs(instructionHandleId: string, newArgs: Buffer): void;
    /**
     * 添加参数绑定
     */
    addParameterBinding(eventHandleKeyOrId: string, param: {
        targetInstructionHandleId: string;
        targetByteOffset: number;
        byteCount: number;
        sourceStartByte: number;
        unkId?: number;
    }): ParameterBinding;
    /**
     * 删除参数绑定
     */
    removeParameterBinding(eventHandleKeyOrId: string, bindingId: string): void;
    /**
     * 重设事件参数绑定
     */
    setEventParameters(eventHandleKeyOrId: string, bindings: ParameterBinding[]): void;
    /**
     * 添加事件
     */
    addEvent(eventId: string | number, restBehavior?: number, instructions?: Array<{
        bank: number;
        id: number;
        args: Buffer;
        unknown?: boolean;
        layerOffset?: number;
    }>): EventHandle;
    /**
     * 删除事件
     */
    deleteEvent(eventHandleKeyOrId: string): void;
    setEventRestBehavior(eventHandleKeyOrId: string, restBehavior: number): void;
    setStrings(bytes: Buffer): void;
    /**
     * 编译模拟结果为最终 IR、重定位表及 Bridge 补丁
     * 严格按照最终事件与指令顺序计算：
     * - eventHandle → 最终 event ID
     * - instructionHandle → 最终 event-local ordinal
     * - instructionHandle → 文件全局 ordinal
     * - parameterBinding → 最终目标索引与字节范围
     */
    compile(): CompiledSimulationPlan;
    /**
     * 生成独立的结构 / IR Oracle 快照，供单元与 native 测试对照
     */
    captureOracleSnapshot(): SimulationOracleSnapshot;
    private buildBridgePatches;
    private assertSafeEventId;
}
