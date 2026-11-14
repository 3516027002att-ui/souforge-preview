/**
 * Read-only projection of the resolved EMEDF registry for editor assistance.
 *
 * EventSourceWorkbenchPanel 用 SoulForge 内置 EMEDF 公开指令名做
 * CodeMirror autocomplete（Ctrl+Space + 输入时）与悬停参数名列表。这里只
 * 从 `EmedfRegistry` 提取公开字段（name/bank/id/args），不触碰任何
 * 第三方源码或外部文件。
 *
 * 本文件只做纯数据投影，不读写文件系统。
 */
import type { EmedfArgType, EmedfEnumDef, EmedfRegistry } from './emedfSchema.js';
export interface EmedfCompletionArg {
    name: string;
    type: EmedfArgType;
    vararg?: boolean;
    enumName?: string;
    description?: string;
    default?: number;
    min?: number;
    max?: number;
    increment?: number;
    formatString?: string;
}
/** 单个可补全指令的公开投影（autocomplete/hover/signature help 消费）。 */
export interface EmedfCompletionItem {
    /** 指令名（PascalCase，EMEDF 公开字段）。 */
    name: string;
    bank: number;
    id: number;
    /** 参数名列表，按 schema 顺序；vararg 尾部由 vararg 标记。 */
    args: EmedfCompletionArg[];
    description?: string;
}
export interface EmedfCompletionCatalog {
    items: EmedfCompletionItem[];
    enums: Record<string, EmedfEnumDef>;
}
/**
 * 把解析好的 EMEDF registry 投影成补全目录。
 * 同名指令（不同 bank:id）全部保留，由 UI 决定去重/展示。
 */
export declare function listEmedfCompletionItems(registry: EmedfRegistry): EmedfCompletionItem[];
export declare function buildEmedfCompletionCatalog(registry: EmedfRegistry): EmedfCompletionCatalog;
