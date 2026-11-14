/**
 * Minimal uncompressed 32-bit BGRA DDS encoder for staged PNG-like RGBA payloads.
 * Accepts raw RGBA8 frames (width*height*4). Not a full PNG decoder —
 * callers that only have PNG bytes must decode first or supply raw RGBA.
 *
 * For smoke/real path without image codec deps: encodeRawRgba8ToDds.
 */
export interface RawRgbaImage {
    width: number;
    height: number;
    /** length === width * height * 4, row-major RGBA */
    rgba: Buffer;
}
export interface DdsEncodeResult {
    dds: Buffer;
    contentHash: string;
    width: number;
    height: number;
    format: 'A8R8G8B8';
}
/**
 * Encode raw RGBA8 into an uncompressed DDS (A8R8G8B8 / BGRA in file).
 * This is a real, shipped encoder used by the asset conversion path.
 */
export declare function encodeRawRgba8ToDds(image: RawRgbaImage): DdsEncodeResult;
/**
 * Create a 1x1 or NxN solid-color test image and encode DDS.
 * Used by conversion smoke when no image decoder is available.
 */
export declare function encodeSolidRgbaDds(input: {
    width: number;
    height: number;
    r: number;
    g: number;
    b: number;
    a?: number;
}): DdsEncodeResult;
export declare function isDdsBuffer(bytes: Buffer): boolean;
