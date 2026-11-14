/**
 * EMEVD 指令参数索引（F3 缺口）。
 *
 * 现象：`NpcParam` 行本身没有任何字段能区分精英/普通/Boss（`npcType` 实测三档：
 * 0=普通敌对 1597 行、1=Boss 38 行、2=友好/中立 NPC 125 行；Boss 不必然取 1
 * （鬼形部 50800000 为 0），精英与杂兵同为 0，因此它判不了精英；`teamType` 也不是
 * 常量，`spEffectID0` 按原型分）。r48 用过的“精英字段”在普通杂兵上取值完全相同。
 * 唯一可机械证明的信号在 EMEVD 侧：`DisplayMinibossHealthBar`
 * (`disabledEnabled=0`) 与 `HandleMinibossDefeat` 的 `entityId` 实参。
 *
 * 数据在哪：C# Bridge 的 `read-emevd-document` 已经返回每条指令的
 * `argsBase64`，EMEDF registry 给出参数布局。缺的不是数据，而是把 47 个
 * 事件文件读一遍、按 `entityId` 建倒排的关系索引；此前 `find_references`
 * 的图只认规则表里的 event-call 参数，event→map entity 没有任何边，
 * `search_events` 也只能按指令名/裸数字做 native 扫描。
 *
 * 这个模块只做有界索引：每个文件读一次（完整文档、分页由 fullDocument 负责），
 * 解码后保留 **实体参数** 的倒排（entityId / targetEntityId，且必须是字面量）。
 * 公共事件形参（`X<offset>_<width>`）无法归到具体实体，单独计数，
 * 既不算证据也不算反证。任何读失败、解码失败、未知指令都进入 coverage，
 * 不允许把“没扫到”说成“没有”。
 */
import type { Diagnostic } from '@soulforge/shared';
import type { ReadFullEmevdDocumentResult } from '../editing/emevdFullDocument.js';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
/** EMEDF 参数名就是 registry 元数据，不是按指令名做的子串猜测。 */
export declare const ENTITY_ARG_NAMES: readonly string[];
/**
 * 引用通道（reference channel）——一个查询问的是“谁引用了这个对象”，
 * 只有与目标同一通道的参数化实参才可能把“看不见”变成“没有”：
 * - entity：地图 part / region 被事件指令的 entityId/targetEntityId 引用；
 * - event：事件被 InitializeEvent/GotoEvent/RunEvent 的 eventId 调用；
 * - text：FMG 文本被 messageId/nameId 等文本实参引用。
 *
 * 每个通道用**精确 EMEDF 实参名**匹配（大小写不敏感），不做子串推断。
 * 名单来自 first-party Sekiro EMEDF 的实参定义，并且与引用图当前会产出
 * `references_map_entity` / `calls_event` / `references_text` 边的实参一致。
 */
export type ParameterizedArgRole = 'entity' | 'event' | 'text';
export declare const PARAMETERIZED_ARG_NAMES_BY_ROLE: Readonly<Record<ParameterizedArgRole, readonly string[]>>;
/**
 * 与 miniboss 判定直接相关的指令名。索引按文件统计它们的出现次数（包含
 * 实体实参参数化的调用），这样“扫过但没有”可以写成 0 次，而不是只说没命中。
 */
export declare const MINIBOSS_EVIDENCE_INSTRUCTION_NAMES: readonly string[];
/**
 * 血条类指令名。它们决定 miniboss 身份（`DisplayMinibossHealthBar`、
 * `HandleMinibossDefeat`），或至少与血条归属有关（`DisplayBossHealthBar`
 * 的显式关闭）。一条血条类指令的实体实参如果是公共事件形参
 * （`X<offset>_<width>`），它可能正好指向目标实体，只是索引看不见——
 * 这种“无法归属”必须能和“确实不存在”区分开。
 */
export declare const BLOOD_BAR_INSTRUCTION_NAMES: readonly string[];
/**
 * Drop-chain evidence carried by the same pass over every EMEVD file.
 *
 * `AwardItemLot(itemLotId)` does **not** carry an entityId, so it never appears in
 * `byEntityId`. A drop chain needs it joined to the events that reference the NPC's
 * map instance; keeping the award instructions here avoids a second 47-file read.
 */
export declare const AWARD_ITEM_LOT_INSTRUCTION_NAME = "AwardItemLot";
/**
 * Instructions that prove an EMEVD event is the NPC's defeat handler. They are
 * not item-lot awards themselves: a boss may be handled here with its reward
 * outside ItemLotParam. The drop-chain resolver uses this to avoid calling a
 * handler-driven boss "broken" just because no lot exists.
 */
export declare const DEFEAT_HANDLER_INSTRUCTION_NAMES: readonly string[];
/**
 * Conditions that make an event a defeat event for the referenced entity. An
 * `AwardItemLot` in an event that merely mentions the entity (a cutscene, a
 * backread toggle) is not that NPC's kill reward; the drop-chain join uses this
 * list before trusting an award.
 */
export declare const DEFEAT_CONDITION_INSTRUCTION_NAMES: readonly string[];
/** Stable key for joining per-event evidence (`sourceUri` + native event id). */
export declare function eventInstructionEventKey(sourceUri: string, eventId: number): string;
/** One `AwardItemLot` call. `itemLotId=null` means the id is not a literal. */
export interface IndexedAwardItemLot {
    sourceUri: string;
    mapId?: string;
    eventId: number;
    instructionIndex: number;
    bank: number;
    id: number;
    instructionName: string;
    itemLotId: number | null;
    /** The itemLotId argument comes from a common-event parameter (`X<offset>_<width>`). */
    parameterized: boolean;
    args: Readonly<Record<string, EventArgScalar>>;
}
/** One defeat-handler instruction carried by an event. */
export interface IndexedDefeatSignal {
    sourceUri: string;
    mapId?: string;
    eventId: number;
    instructionIndex: number;
    instructionName: string;
    args: Readonly<Record<string, EventArgScalar>>;
}
/** 参数化实体实参按指令名的条数。 */
export interface EventInstructionNameCount {
    name: string;
    count: number;
}
export type EventArgScalar = string | number | boolean;
export interface EventInstructionIndexFile {
    /** 工作区逻辑身份（`file://event/m11_00_00_00.emevd.dcx`）。 */
    sourceUri: string;
    absolutePath: string;
    /** 从文件名派生的地图 id（`m11_00_00_00`），用于同图归属。 */
    mapId?: string;
    size?: number;
    mtimeMs?: number;
}
export interface EventInstructionIndexFileCoverage {
    sourceUri: string;
    mapId?: string;
    readOk: boolean;
    errorCode?: string;
    errorMessage?: string;
    events: number;
    instructions: number;
    decodedInstructions: number;
    unknownInstructions: number;
    decodeFailures: number;
    /** `X<offset>_<width>` 形式的实体实参：无法归属到具体实体。 */
    parameterizedEntityArgs: number;
    /**
     * 上述无法归属的调用按指令名计数（排序）。消费方据此判断**本次查询的指令类**
     * 是否也存在参数化实参，而不是只看全局结构完整性。
     */
    parameterizedInstructionCounts: EventInstructionNameCount[];
    /** `X<offset>_<width>` 形式的 eventId 实参：无法归属到具体事件。 */
    parameterizedEventArgs: number;
    /** 上述无法归属的事件调用按指令名计数（排序）。 */
    parameterizedEventInstructionCounts: EventInstructionNameCount[];
    /** `X<offset>_<width>` 形式的文本 id 实参：无法归属到具体 FMG 条目。 */
    parameterizedTextArgs: number;
    /** 上述无法归属的文本引用按指令名计数（排序）。 */
    parameterizedTextInstructionCounts: EventInstructionNameCount[];
    /**
     * 上述无法归属的指令里，指令名属于血条类（`BLOOD_BAR_INSTRUCTION_NAMES`）的条数。
     * 它们可能正指向目标实体，只是实参来自公共事件形参；消费方不能用它们当反证。
     */
    parameterizedBloodBarInstructions: number;
    /** 该文件中出现过的参数化血条类指令名（去重排序），用于人读说明。 */
    parameterizedBloodBarInstructionNames: string[];
    /** 本文件中 DisplayMinibossHealthBar + HandleMinibossDefeat 的出现次数（含参数化）。 */
    minibossInstructions: number;
    sourceHash?: string;
    outerFileHash?: string;
}
/**
 * 一条可归属的实体引用。`instructionName`/`bank`/`id` 均来自 EMEDF 定义，
 * `args` 是同一指令的全部字面量参数（用于证据原文与附加过滤）。
 */
export interface IndexedEntityReference {
    entityId: number;
    entityArgName: string;
    sourceUri: string;
    mapId?: string;
    eventId: number;
    instructionIndex: number;
    bank: number;
    id: number;
    instructionName: string;
    args: Readonly<Record<string, EventArgScalar>>;
}
export interface EventInstructionIndexCoverage {
    status: 'complete' | 'partial' | 'unavailable';
    filesDiscovered: number;
    filesRead: number;
    filesFailed: number;
    eventsScanned: number;
    instructionsScanned: number;
    instructionsDecoded: number;
    unknownInstructions: number;
    decodeFailures: number;
    parameterizedEntityArgs: number;
    /** 全索引参数化调用按指令名的计数；语义同文件级字段。 */
    parameterizedInstructionCounts: EventInstructionNameCount[];
    /** 全索引中 eventId 实参参数化的调用条数。 */
    parameterizedEventArgs: number;
    /** 全索引中 eventId 实参参数化的调用按指令名的计数。 */
    parameterizedEventInstructionCounts: EventInstructionNameCount[];
    /** 全索引中文本 id 实参参数化的调用条数。 */
    parameterizedTextArgs: number;
    /** 全索引中文本 id 实参参数化的调用按指令名的计数。 */
    parameterizedTextInstructionCounts: EventInstructionNameCount[];
    /** 参数化指令中血条类指令的条数（见 `BLOOD_BAR_INSTRUCTION_NAMES`）。 */
    parameterizedBloodBarInstructions: number;
    /** 全局出现过的参数化血条类指令名（去重排序）。 */
    parameterizedBloodBarInstructionNames: string[];
    /**
     * **只表示索引结构完整**：每个文件都完整读出、没有未知指令、没有解码失败。
     *
     * 它不知道“本次查询依赖的引用通道是否也有无法归属的参数化实参”，因此
     * 绝不能直接当作工具输出的 `negativeConclusionAllowed`：消费方必须用
     * `assessParameterizedEntityCoverage`（按本次查询的通道/指令类/地图）
     * 再判定一次。字段名里的 structural 前缀就是为了让透传在代码审查和
     * 治理检查（runNegativeConclusionGateSmoke）里都显眼。
     */
    structuralNegativeConclusionAllowed: boolean;
    failures: Array<{
        sourceUri: string;
        code: string;
        message: string;
    }>;
}
export interface EventInstructionIndex {
    workspaceId: string;
    builtAt: number;
    buildMs: number;
    files: EventInstructionIndexFileCoverage[];
    entityReferences: IndexedEntityReference[];
    byEntityId: Map<number, IndexedEntityReference[]>;
    /** All literal/parameterized AwardItemLot calls, in file/event/instruction order. */
    awardItemLots: IndexedAwardItemLot[];
    /** Join key is {@link eventInstructionEventKey}; used by the drop-chain resolver. */
    awardItemLotsByEvent: Map<string, IndexedAwardItemLot[]>;
    /** Defeat-handler instructions, in file/event/instruction order. */
    defeatSignals: IndexedDefeatSignal[];
    defeatSignalsByEvent: Map<string, IndexedDefeatSignal[]>;
    coverage: EventInstructionIndexCoverage;
}
export interface BuildEventInstructionIndexInput {
    workspaceId: string;
    files: readonly EventInstructionIndexFile[];
    registry: EmedfRegistry;
    /** 生产实现走 Bridge 完整文档读取；单元测试注入合成文档。 */
    readDocument: (file: EventInstructionIndexFile) => Promise<ReadFullEmevdDocumentResult>;
    signal?: AbortSignal;
}
/** 从 `file://event/m11_00_00_00.emevd.dcx` 取 `m11_00_00_00`。 */
export declare function eventMapIdFromSourceUri(sourceUri: string): string | undefined;
/**
 * 读所有事件文件并建立实体倒排。调用方负责提供已按 `isActiveSemanticSource`
 * 过滤的 event 文件；本函数不会把 `.bak`/缓存文件当成事件源。
 */
export declare function buildEventInstructionIndex(input: BuildEventInstructionIndexInput): Promise<EventInstructionIndex>;
export interface EventInstructionReferenceQuery {
    entityId?: number;
    /** 指令名精确匹配（大小写不敏感，EMEDF 原名）。 */
    instructionName?: string;
    /** 指令名子串匹配（大小写不敏感），用于模糊定位。 */
    instructionContains?: string;
    eventId?: number;
    /** 只保留该 sourceUri 的命中。 */
    sourceUri?: string;
    /** 只保留该地图（事件文件 stem）的命中。 */
    mapId?: string;
    limit: number;
    offset?: number;
}
export interface EventInstructionReferenceSearch {
    matches: IndexedEntityReference[];
    total: number;
    offset: number;
    limit: number;
    truncated: boolean;
}
/**
 * 倒排查询。`entityId` 命中按 (sourceUri, eventId, instructionIndex) 去重，
 * 保证同一指令同时带 entityId/targetEntityId 时只出现一次。
 */
export declare function searchEventInstructionReferences(index: EventInstructionIndex, query: EventInstructionReferenceQuery): EventInstructionReferenceSearch;
/** 索引失败项转成工具层可读诊断（不吞错误）。 */
export declare function eventInstructionIndexDiagnostics(index: EventInstructionIndex): Diagnostic[];
export interface GetEventInstructionIndexInput extends Omit<BuildEventInstructionIndexInput, 'workspaceId'> {
    workspaceId: string;
}
/**
 * 同一工作区 + 同一文件指纹只建一次；并发调用合并到同一个 promise。
 * 索引是只读投影，文件大小/mtime 任一变化都会换指纹重建。
 */
export declare function getEventInstructionIndex(input: GetEventInstructionIndexInput): Promise<EventInstructionIndex>;
/** 测试隔离：清掉模块级缓存。 */
export declare function clearEventInstructionIndexCache(): void;
