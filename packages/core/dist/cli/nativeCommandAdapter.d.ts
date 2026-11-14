/** T11-A 旧 CLI 语法到已有工具参数的映射；只做映射，不直连底层 facade。 */
export interface MappedToolCall {
    tool: string;
    args: Record<string, unknown>;
}
export type ToolInputMappingResult = {
    ok: true;
    input: Record<string, unknown>;
} | {
    ok: false;
    code: string;
    message: string;
};
/**
 * Normalize arguments shared by the CLI and Agent paths.
 *
 * The CLI must not grow a second interpretation of the reference-query
 * contract.  Validate `find_references` with the shared decoder, but return
 * the original wire-shaped object: the decoder's internal
 * `cursorScopeCheckRequired` field is host state and must never be sent back
 * through the public tool boundary.
 */
export declare function mapCliArgumentsToToolInput(tool: string, args: Record<string, unknown>): ToolInputMappingResult;
export declare function mapLegacyCliCommand(command: string, options: Record<string, string>): MappedToolCall;
