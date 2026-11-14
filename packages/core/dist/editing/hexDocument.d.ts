/**
 * Safe Hex document model — virtualized page access over owned bytes.
 * Mutations produce EditorMutation-compatible payloads; no filesystem I/O.
 */
export interface HexPage {
    offset: number;
    length: number;
    bytesBase64: string;
}
export interface HexBytePatch {
    offset: number;
    oldBytesBase64: string;
    newBytesBase64: string;
}
export declare class HexDocument {
    private bytes;
    readonly pageSize: number;
    constructor(bytes: Buffer, pageSize?: number);
    get byteLength(): number;
    get contentHash(): string;
    pageCount(): number;
    readPage(pageIndex: number): HexPage;
    applyPatch(patch: HexBytePatch): {
        ok: true;
        contentHash: string;
    } | {
        ok: false;
        code: string;
        message: string;
    };
    snapshot(): Buffer;
}
