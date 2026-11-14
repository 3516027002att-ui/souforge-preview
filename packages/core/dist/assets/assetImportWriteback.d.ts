/**
 * Asset import → PatchIR writeback.
 * Stages open-format bytes, then commits them into the Mod overlay only through
 * the existing durable PatchIR / WorkspaceTransaction path (file_replace).
 */
import type { Diagnostic } from '@soulforge/shared';
import { type AssetImportRequest } from './assetImport.js';
import { type ExecutePatchIrOptions } from '../patch/durablePatchCommit.js';
export interface AssetImportWritebackRequest extends AssetImportRequest {
    workspaceId: string;
    /** Absolute path of the overlay file to replace (must already be resolved by session). */
    targetAbsolutePath: string;
    expectedTargetHash: string;
    confirmationReceiptId: string;
    title?: string;
}
export interface AssetImportWritebackResult {
    ok: boolean;
    importId?: string;
    stagingPath?: string;
    contentHash?: string;
    opId?: string;
    changedFiles: string[];
    diagnostics: Diagnostic[];
}
/**
 * Production entry: stage open-format asset, then PatchIR file_replace into overlay.
 * Does not bypass Patch Engine, hash checks, or confirmation metadata.
 */
export declare function commitAssetImportThroughPatchIr(request: AssetImportWritebackRequest, transactionOptions: ExecutePatchIrOptions): Promise<AssetImportWritebackResult>;
