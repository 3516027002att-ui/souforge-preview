/**
 * NpcParam 行 → 地图实例 → EMEVD 指令 的 miniboss 证据判定。
 *
 * 判定只用 EMEVD 的**字面量**实体参数：
 *   - `DisplayMinibossHealthBar(entityId, disabledEnabled=0)` → 精英血条被打开；
 *   - `HandleMinibossDefeat(entityId)` → 精英击败结算；
 *   - `DisplayBossHealthBar(entityId, disabledEnabled=1)` 只作为辅助证据
 *     （Boss 条显式关闭），本身不能证明 miniboss。
 *
 * 没有证据时绝不直接说“不是”：先看覆盖率。若某些事件文件没读到、
 * 存在未知/解码失败指令、地图没有事件文件、或实体 identity 缺失，
 * 结论必须是 `inconclusive`（isMiniboss=null），而不是 `no-evidence`。
 *
 * 还有一类“看不见”必须和“确实没有”区分：实体实参来自公共事件形参
 * （`X<offset>_<width>`）的指令无法归属到具体实体。若本行所在地图里这类指令
 * **包含血条类指令名**（`DisplayMinibossHealthBar` / `HandleMinibossDefeat` /
 * `DisplayBossHealthBar`），它可能正指向本行实例，否定结论不可用；
 * 若这类指令都不含血条类指令名，则与判定无关，否定结论仍成立（caveat 保留）。
 */
import type { SymbolBundle } from '@soulforge/shared';
import type { EventInstructionIndex, EventInstructionIndexCoverage } from './eventInstructionIndex.js';
export declare const MINIBOSS_BAR_INSTRUCTION = "DisplayMinibossHealthBar";
export declare const MINIBOSS_DEFEAT_INSTRUCTION = "HandleMinibossDefeat";
export declare const BOSS_BAR_INSTRUCTION = "DisplayBossHealthBar";
export type MinibossVerdict = 'miniboss' | 'no-evidence' | 'inconclusive';
export type MinibossEvidenceKind = 'miniboss-health-bar-enabled' | 'miniboss-defeat-handler' | 'boss-health-bar-disabled';
export interface MinibossInstance {
    mapId: string;
    partName: string;
    entityId?: number;
    npcParamRowId: number;
    mapSourceUri?: string;
    position?: [number, number, number];
}
export interface MinibossEvidence {
    kind: MinibossEvidenceKind;
    /** 证据是否直接证明精英身份；`boss-health-bar-disabled` 只是辅助。 */
    provesMiniboss: boolean;
    instructionName: string;
    bank: number;
    id: number;
    sourceUri: string;
    eventId: number;
    eventUri: string;
    instructionIndex: number;
    entityId: number;
    entityArgName: string;
    mapId?: string;
    partName?: string;
    args: Readonly<Record<string, string | number | boolean>>;
    /** 人读原文：`DisplayMinibossHealthBar#10(disabledEnabled=0, entityId=1100800, ...)`。 */
    statement: string;
}
export interface MinibossMapCoverage {
    mapId: string;
    instances: number;
    eventFiles: number;
    readOkFiles: number;
    /** 该地图事件文件中 DisplayMinibossHealthBar + HandleMinibossDefeat 的出现次数（含参数化）。 */
    minibossInstructions: number;
    /** 该地图事件文件中实体实参来自公共事件形参、无法归属的指令条数。 */
    parameterizedEntityArgs: number;
    /** 上述无法归属的指令里，血条类指令的条数。>0 时否定结论不可用。 */
    parameterizedBloodBarInstructions: number;
    complete: boolean;
}
export interface MinibossAnswer {
    table: string;
    npcParamRowId: number;
    isMiniboss: boolean | null;
    verdict: MinibossVerdict;
    row: {
        found: boolean;
        rowName?: string;
        sourceUri?: string;
        entryName?: string;
    };
    instances: MinibossInstance[];
    evidence: MinibossEvidence[];
    supporting: MinibossEvidence[];
    coverage: {
        index: EventInstructionIndexCoverage;
        maps: MinibossMapCoverage[];
        /** 本行所在地图里，实体实参参数化（无法归属）的指令总条数。 */
        parameterizedEntityArgs: number;
        /** 其中血条类指令的条数；>0 时 `negativeConclusionAllowed` 必为 false。 */
        parameterizedBloodBarInstructions: number;
        /**
         * 参数化血条类指令是否阻止了否定结论。
         * true：无法归属的血条调用可能正指向本行实例 → 只能 inconclusive；
         * false：参数化指令与血条无关（或不存在）→ 否定结论不受影响。
         */
        parameterizedBlocksNegative: boolean;
        /** 只有 true 时，“没有证据”才等于“不是 miniboss”。 */
        negativeConclusionAllowed: boolean;
    };
    blockedReasons: string[];
    caveats: string[];
}
export interface ExplainMinibossInput {
    npcParamRowId: number;
    /** 默认 NpcParam；接受 NpcParam / NPC_PARAM_ST 等别名。 */
    table?: string;
    bundle: Pick<SymbolBundle, 'maps' | 'params'>;
    index: EventInstructionIndex;
    maxEvidence?: number;
}
/**
 * 判定一个 NpcParam 行是否 miniboss。纯函数：索引与 symbol bundle 由调用方提供，
 * 因此可以用合成夹具做单元测试，也可以在工具层复用同一份 index 缓存。
 */
export declare function explainMiniboss(input: ExplainMinibossInput): MinibossAnswer;
