import type { RegisteredTool } from '../toolRegistry.js';
/**
 * explain_miniboss: 机械回答“这个 NpcParam 行是不是 miniboss，证据是哪条事件”。
 *
 * 数据不在 NpcParam 里（`npcType` 只有 0=普通敌对 / 1=Boss / 2=友好·中立 三档，
 * 精英没有独立档位、与杂兵同为 0；`teamType`/`spEffectID0` 对精英和杂兵也同值），
 * 而在 EMEVD 的实体参数上：`DisplayMinibossHealthBar(entityId, disabledEnabled=0)`
 * 与 `HandleMinibossDefeat(entityId)`。工具把 NpcParam 行 → 地图 part
 * （原生 `npcParamRowId` 外键）→ `entityId` → 事件指令串起来，并给出覆盖率。
 * 没有证据且覆盖完整时才返回 `no-evidence`；否则返回 `inconclusive`。
 */
export declare function createExplainMinibossTool(): RegisteredTool;
