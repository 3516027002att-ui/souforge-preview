/**
 * 返回可搜索的指令名。输入是占位符时按 bank/id 查 first-party EMEDF；
 * 其它输入原样返回，查不到时也返回原值（不丢信息、不猜测）。
 */
export declare function resolveEventInstructionName(name: unknown, bank?: unknown, id?: unknown): string | undefined;
