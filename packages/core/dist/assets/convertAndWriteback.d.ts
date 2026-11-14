/**
 * Open-format → native-ish DDS conversion then PatchIR writeback.
 * Current production conversion: raw RGBA / solid → uncompressed A8R8G8B8 DDS.
 */
import type { Diagnostic } from '@soulforge/shared';
import { type RawRgbaImage } from './pngToDds.js';
import type { ExecutePatchIrOptions } from '../patch/durablePatchCommit.js';
export interface ConvertRgbaToDdsWritebackRequest {
    workspaceId: string;
    stagingRoot: string;
    targetAssetUri: string;
    targetAbsolutePath: string;
    expectedTargetHash: string;
    confirmationReceiptId: string;
    conversionRuleId: string;
    image: RawRgbaImage | {
        solid: {
            width: number;
            height: number;
            r: number;
            g: number;
            b: number;
            a?: number;
        };
    };
    title?: string;
}
export declare function convertRgbaToDdsAndWriteback(request: ConvertRgbaToDdsWritebackRequest, transactionOptions: ExecutePatchIrOptions): Promise<{
    ok: boolean;
    ddsHash?: string;
    opId?: string;
    changedFiles: string[];
    diagnostics: Diagnostic[];
}>;
