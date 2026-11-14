/**
 * read_msb_parts 的地址身份。
 *
 * MSB 允许同名 part：`m11_01_00_00.msb.dcx` 里 `c1010_0071` 有两份（0x4E3370 / 0x4F50C0）。
 * `<mapId>#<name>` 因此不是唯一标识——按地址建索引会丢条目，按名字配对会错位。
 * 这里把「怎么生成地址」和「怎么按地址选中」收成两个纯函数，读路径与写路径共用，
 * 并可以脱离 Bridge 单测。
 *
 * 别名规则：唯一名字仍输出 `<mapId>#<name>`（既有调用方一字不变）；只有重名 part
 * 追加 `@0x<offset>`，并且旧形式仍然可解析——重名时按名字解析必须报歧义，不能取第一条。
 */
export interface MsbAddressablePart {
    name: string;
    nativeOffset: number;
    typeId?: number;
}
export interface MsbPartAddressCandidate {
    address: string;
    name: string;
    nativeOffset: number;
    typeId?: number;
}
/** nativeOffset → 该 part 的唯一地址（与索引/RAG/工具共用同一格式化函数）。 */
export declare function formatMsbPartAddresses(mapId: string, parts: ReadonlyArray<MsbAddressablePart>): Map<number, string>;
export interface MsbPartAddressRequest {
    /** 调用方原样传入的地址，仅用于错误信息。 */
    raw: string;
    name: string;
    nativeOffset?: number;
}
export type MsbPartSelection<T extends MsbAddressablePart> = {
    ok: true;
    parts: T[];
} | {
    ok: false;
    code: 'MSB_PART_NOT_FOUND' | 'MSB_ADDRESS_AMBIGUOUS';
    message: string;
    details: {
        missing?: string[];
        ambiguous?: Array<{
            address: string;
            candidates: MsbPartAddressCandidate[];
        }>;
    };
};
/**
 * 按地址选中 part。带 `@0x<offset>` 的地址精确命中一条；不带偏移的旧地址只在名字
 * 唯一时可用，重名时整次读取失败并列出候选（fail-closed，绝不取第一条）。
 * 返回顺序保持文档顺序，与不传地址时一致。
 */
export declare function selectMsbParts<T extends MsbAddressablePart>(mapId: string, parts: ReadonlyArray<T>, requests: ReadonlyArray<MsbPartAddressRequest>): MsbPartSelection<T>;
