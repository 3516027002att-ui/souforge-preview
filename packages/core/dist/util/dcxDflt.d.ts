/**
 * DFLT-wrapped DCX decompression (shared by native EMEVD smokes and the
 * full-document reader). KRAK or unknown inner formats fail structurally:
 * they are not supported by the DFLT-only path.
 */
export declare function isDcxWrapper(source: Buffer): boolean;
export declare function decompressDfltDcx(source: Buffer): Buffer;
