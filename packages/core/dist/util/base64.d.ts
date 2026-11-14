/**
 * Strict base64 decode for raw/container write paths.
 * Node's Buffer.from(str, 'base64') is too lenient for untrusted input.
 */
export interface DecodeStrictBase64Options {
    /** When false (default), empty decoded payload fails. */
    allowEmpty?: boolean;
}
export declare class StrictBase64Error extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * Decode base64 with strict character/length/roundtrip checks.
 */
export declare function decodeStrictBase64(input: string, options?: DecodeStrictBase64Options): Buffer;
export declare function encodeBase64(bytes: Buffer | Uint8Array): string;
