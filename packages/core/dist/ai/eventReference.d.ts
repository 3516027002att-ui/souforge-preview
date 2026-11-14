/**
 * 社区积累的 Sekiro 事件经验笔记的轻量语义索引。
 *
 * 这些条目只用于把“血条、落雷、掉落”等自然语言映射到可能的 EMEVD
 * 指令名。它们是有价值的领域经验，但不是当前工作区的 native snapshot；
 * 调用方必须继续用 search_events/read_emevd_outline 和当前 EMEDF 确认具体身份。
 */
export interface EventReferenceMatch {
    instruction: string;
    aliases: string[];
    description: string;
    sourceUri: string;
    authority: 'community-reference';
    score: number;
}
export declare const EVENT_REFERENCE_SOURCE_URI = "reference://community/sekiro-event-notes";
/**
 * Terms that describe a combat move rather than an EMEVD instruction.
 *
 * Sekiro encodes moves in TAE animation events plus AtkParam_Pc / BehaviorParam / Bullet rows;
 * EMEVD only supplies the conditions and the resource awards. Answering "not in the glossary"
 * for these terms sends an agent hunting for an instruction that cannot exist, so they route to
 * the action layer explicitly instead.
 */
export interface ActionLevelConcept {
    term: string;
    guidance: string;
    tools: string[];
}
/** Route a query to the action layer when the term cannot be an EMEVD instruction. */
export declare function classifyActionLevelQuery(query: string): ActionLevelConcept | undefined;
export declare function searchEventReference(query: string, limit?: number): EventReferenceMatch[];
