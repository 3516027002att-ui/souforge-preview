import type { BridgeResult, Diagnostic, MapExport, ParseStatus } from '@soulforge/shared';
import type { WorkspaceIndex } from './workspaceIndex.js';
export interface IngestResult {
    accepted: boolean;
    parseStatus: ParseStatus;
    diagnostics: Diagnostic[];
}
/**
 * Converts structured BridgeResult JSON into WorkspaceIndex symbols.
 *
 * This is intentionally defensive: the bridge is allowed to return partial or
 * unsupported results, but the index must not accept fake/malformed symbols.
 */
export declare function ingestBridgeResult(index: WorkspaceIndex, result: BridgeResult<unknown>): IngestResult;
/**
 * 把 MSB 的 parts[] / regions[] 投影成 MapExport 需要的 data 形状。
 * 生产 analyze 现在优先消费 C# export-map 的同形结果；保留这个适配器供
 * read-msb-document 及旧调用方继续使用。
 */
export declare function mapExportFromMsbDocument(input: {
    mapId: string;
    sourceUri: string;
    sourceHash?: string;
    /** SHA-256 of the packed/outer file opened by the Bridge. */
    outerFileHash?: string;
    sourceRevision?: number;
    readerSchemaRevision?: number;
    derivedKey?: string;
    parts?: Array<{
        name?: string | number;
        typeId?: number;
        modelIndex?: number;
        posX?: number;
        posY?: number;
        posZ?: number;
        rotX?: number;
        rotY?: number;
        rotZ?: number;
        scaleX?: number;
        scaleY?: number;
        scaleZ?: number;
        internalEntryId?: number;
        entityId?: number;
        entityGroupId?: number;
        npcParamRowId?: number;
        model?: string;
        /** Native absolute file offset (Bridge read-msb-document parts[].offset). */
        nativeOffset?: number;
    }>;
    regions?: Array<{
        name?: string | number;
        typeId?: number;
        posX?: number;
        posY?: number;
        posZ?: number;
        internalEntryId?: number;
        entityId?: number;
        /** Native absolute file offset (Bridge read-msb-document regions[].offset). */
        nativeOffset?: number;
    }>;
}): MapExport;
