import type { RegisteredTool } from '../toolRegistry.js';
/**
 * search_field_names：跨 PARAM / TAE 的字段名词典。
 *
 * 与 `search_param_fields` 的分工：
 *   · `search_param_fields` 要先有 table + rowIds，回答「这一行有哪些字段、真实 fieldId 是什么」；
 *   · 本工具不需要工作区、不需要行：回答「用户说的这个名字是哪个字段、属于哪张表/哪个事件」。
 *
 * 这正是「判定距离」这一类问题的入口——它既可能是 PARAM 的距离字段，也可能是 TAE 事件
 * 760 (`Set Root Motion Multiplier`) 的 `Reference Distance` / `Enable Range Maximum`。
 * 只给一个候选会让 agent 猜；这里把两个都返回，并由 `semantics` 说明基准距离与上限的区别。
 *
 * 边界：PARAM 候选只来自本作 gameparam 里真实存在的表（122 个 native 类型）。随包 paramdef
 * 是类型字典（160 个），其中 38 个类型在本作没有子文件；它们的字段只出现在 `notInGame`
 * 里解释「为什么这个名字没有可读的表」，绝不会成为 `items` 里可以照抄的答案。
 */
export declare function createSearchFieldNamesTool(): RegisteredTool;
