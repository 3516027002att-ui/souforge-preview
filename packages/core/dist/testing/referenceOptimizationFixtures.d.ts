import type { EventExport, ParamExport, SymbolBundle } from '@soulforge/shared';
export declare function fixtureHash(content: string | Buffer): string;
export declare const FIXTURE_VERSION_BYTES: Record<'H0' | 'H1' | 'H2', Buffer>;
export declare const FIXTURE_VERSION_HASHES: Record<'H0' | 'H1' | 'H2', string>;
export interface NativeCallCounters {
    cliHostStarts: number;
    workspaceOpenCount: number;
    bridgeProcessStarts: number;
    containerInventoryCount: number;
    childExtractionCount: number;
    nativeParseCount: number;
    fullDocumentAssemblyCount: number;
    relationShardBuildCount: number;
    coalescedWaiterCount: number;
    freshVerificationReadCount: number;
    modelToolCalls: number;
    writerCalls: number;
}
export declare function newFixtureCounters(): NativeCallCounters;
export interface FixtureChild {
    entryIndex: number;
    entryName: string;
    payload: Buffer;
    /** 'source' | 'bytecode' | 'catalog-only' — never collapse these. */
    contentKind: 'source' | 'bytecode' | 'catalog-only';
}
export interface FixtureOuter {
    sourceUri: string;
    outerBytes: Buffer;
    mtimeMs: number;
    children: FixtureChild[];
    /** Parsed-document payload; providers must go through parse(), not read this. */
    document?: SymbolBundle;
}
/**
 * Lowest-level native port double. Every method increments its own counter so
 * performance smokes measure real call counts instead of hand-tallied
 * expectations. `swapOuter` / `swapChild` simulate external edits (including
 * same-mtime content changes for V01).
 */
export declare class FixtureNativeBackend {
    readonly counters: NativeCallCounters;
    private readonly outers;
    private readonly metadataSchemas;
    /** When set, the next parse() of this source throws once (failure injection). */
    private readonly failNextParse;
    /** In-flight parse join registry the backend itself never dedups — the cache layer must. */
    parseJoinObserved: boolean;
    addOuter(outer: FixtureOuter): void;
    getOuter(sourceUri: string): FixtureOuter | undefined;
    setMetadataSchema(sourceUri: string, schema: string): void;
    metadataSchema(sourceUri: string): string | undefined;
    /** Simulate an external edit; pass keepMtime=true for the V01 case. */
    swapOuter(sourceUri: string, outerBytes: Buffer, options?: {
        keepMtime?: boolean;
    }): void;
    swapChild(sourceUri: string, entryIndex: number, payload: Buffer): void;
    failNext(sourceUri: string): void;
    inventory(sourceUri: string): Array<{
        entryIndex: number;
        entryName: string;
        contentKind: string;
    }>;
    extractChild(sourceUri: string, entryIndex: number): Buffer;
    parse(sourceUri: string): SymbolBundle;
    assembleFullDocument(sourceUri: string): SymbolBundle;
    buildRelationShard(sourceUri: string): void;
    freshVerificationRead(sourceUri: string): void;
    write(sourceUri: string, bytes: Buffer): void;
}
export declare const FIXTURE_WORKSPACE_A = "fixture-workspace-A";
export declare const FIXTURE_WORKSPACE_B = "fixture-workspace-B";
/** Same relative path in both workspaces (I01: identical path must not merge). */
export declare const FIXTURE_SHARED_RELATIVE_PATH = "Event/Param/ParamGame/GameParam.parambnd.dcx";
export declare const FIXTURE_NPC_PARAM = "NpcParam";
export declare const FIXTURE_TARGET_ROW_ID = 50800000;
export declare const FIXTURE_REF_FIELD_ID = "ThinkParamId";
export declare const FIXTURE_THINK_PARAM = "ThinkParam";
export declare const FIXTURE_EVENT_ID = 6000;
export declare function buildWorkspacePairBundles(): {
    bundleA: SymbolBundle;
    bundleB: SymbolBundle;
};
export declare function buildDuplicateIdentityBundle(): SymbolBundle;
export declare const FIXTURE_REFS_SYNTAX = "Bullet(refType=1),AtkParam_Npc(refType=0),SpEffectParam(refType=2)";
export declare const FIXTURE_REFS_UNKNOWN = "Bullet(refType=1),NotATarget!!(x=)";
export interface FixtureConditionalRefRow {
    rowId: number;
    refId: number;
    refType: number | null;
    expect: 'hit' | 'miss' | 'unresolved-condition' | 'rejected-syntax';
}
export declare const FIXTURE_CONDITIONAL_ROWS: FixtureConditionalRefRow[];
export declare function buildConditionalRefBundle(): SymbolBundle;
export declare const FIXTURE_EMEVD_FILE_X = "workspace://fixture-workspace-A/mods/event/x/m11_00_00_00.emevd.dcx";
export declare const FIXTURE_EMEVD_FILE_Y = "workspace://fixture-workspace-A/mods/event/y/m11_01_00_00.emevd.dcx";
/** The ID one event passes to the other through an initialization-call argument. */
export declare const FIXTURE_PASSED_TARGET_ID = 6000;
export declare function buildEmevdCrossFileBundle(): SymbolBundle;
export declare const FIXTURE_MAP_SOURCE = "workspace://fixture-workspace-A/mods/map/m11_02_00_00/m11_02_00_00.msb.dcx";
export declare const FIXTURE_SHARED_MODEL = "c1050.tai";
export declare function buildMapInstanceBundle(): SymbolBundle;
export declare const FIXTURE_LUABND_SOURCE = "workspace://fixture-workspace-A/mods/script/m11_00_00_00.luabnd.dcx";
export declare const FIXTURE_LUA_ENTRY_NAME = "m11_00_00_00.lua";
export declare const FIXTURE_BYTECODE_ENTRY_NAME = "m11_00_00_00.lua.bc";
export declare const FIXTURE_LUA_TEXT: string;
export declare function buildScriptBundle(): SymbolBundle;
export declare const FIXTURE_LONG_STATEMENT: string;
export declare const FIXTURE_CJK_EMOJI_STATEMENT = "ShowMessage(\"\u7BDD\u706B\uD83D\uDD25\u5DF2\u70B9\u71C3 \u2014\u2014 \u8BF7\u786E\u8BA4\", 42)";
export declare function buildScenarioABundle(): SymbolBundle;
/** Every fixture source in scenario A carries a distinct outer hash (§6). */
export declare function scenarioAOuterHashes(bundle: SymbolBundle): string[];
export declare function fixtureEventExport(sourceUri: string, outerTag: string, events: EventExport['events']): EventExport;
export declare function fixtureParamExport(sourceUri: string, outerTag: string, rows: ParamExport['rows'], entryName: string, entryIndex: number): ParamExport;
