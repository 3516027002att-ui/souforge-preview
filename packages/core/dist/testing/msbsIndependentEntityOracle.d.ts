/**
 * Independent MSBS EntityID Oracle.
 *
 * Dedicated strictly to testing and verification (NOT exported from production barrels).
 * Implements an independent binary reader for Sekiro MSBS Part/Region layouts:
 * - Part InternalEntryId: entry + 0x0C
 * - Part EntityData offset pointer: entry + 0x60 -> EntityID: entry + relative
 * - Region InternalEntryId: entry + 0x0C
 * - Region BaseData3 offset pointer: entry + 0x50 -> ActivationPartIndex: entry + relative + 0, EntityID: entry + relative + 4
 *
 * Zero dependencies on Bridge source or C# helpers.
 */
export interface OraclePartRecord {
    name: string;
    entryOffset: number;
    typeId: number;
    internalEntryId: number;
    modelIndex: number;
    entityDataPointer: bigint;
    entityDataAddress: number;
    entityId: number;
}
export interface OracleRegionRecord {
    name: string;
    entryOffset: number;
    typeId: number;
    internalEntryId: number;
    baseData3Pointer: bigint;
    baseData3Address: number;
    activationPartIndex: number;
    entityId: number;
}
export interface MsbsOracleResult {
    version: number;
    parts: OraclePartRecord[];
    regions: OracleRegionRecord[];
    partByName: Map<string, OraclePartRecord>;
    regionByName: Map<string, OracleRegionRecord>;
}
export declare function readPartEntityOracle(buf: Buffer, entryOffset: number): OraclePartRecord;
export declare function readRegionEntityOracle(buf: Buffer, entryOffset: number): OracleRegionRecord;
export declare function readMsbsEntityOracle(buf: Buffer): MsbsOracleResult;
