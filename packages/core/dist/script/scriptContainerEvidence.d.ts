/**
 * Production script container evidence projection (W-BEHAVIOR-MAP-01).
 *
 * Provides a readonly, structured container-level magic/reference inventory
 * for script containers (luabnd, talkesdbnd) backing the
 * script editor:
 *   - entry enumeration (BND4 reference table: name / index / size / id);
 *   - extension distribution across the whole container;
 *   - `\x1bLua` compiled-bytecode identification from real header bytes
 *     (bounded magic sample);
 *   - LUAGNL / LUAINFO / ESD / HKX classification;
 *   - bounded hex evidence (first 32 bytes per sampled script entry).
 *
 * Real-corpus finding (W-BEHAVIOR-MAP-01 probe, Sekiro luabnd): inner `.lua`
 * entries are a MIX of Havok Script compiled bytecode with magic
 * `\x1bLuaP` (0x1b 0x4c 0x75 0x61 0x50) and plain-text list files
 * (e.g. goal_list.lua — but NOT logic_list.lua, which measured as `\x1bLuaP`
 * bytecode with a 0.6121 printable ratio; this comment previously cited it as
 * a plain-text example). The `\x1bLuaQ` magic is the vanilla
 * Lua 5.1 variant; both are recognized as the `\x1bLua` family. Whether a
 * specific entry's real bytes matched is reported via `magicVerified` and its
 * bounded `headerHex` — extension-based classification alone never claims
 * bytecode.
 *
 * Sekiro BND4 inner names are absolute paths from the original build machine
 * (e.g. `N:\NTC\data\Target\INTERROOT_win64\script\ai\out\bin\goal_list.lua`);
 * evidence entry names are therefore sanitized to their basename so no
 * absolute path ever reaches the editor/renderer.
 *
 * This inventory projection does not decompile, recompile, or execute scripts.
 * Standalone source reading is a separate path, not a synthetic container.
 *
 * Authority cap: `candidate`. This projection proves container-level
 * enumeration, bytecode format identification and bounded header evidence
 * only — never script semantics, decompilation, recompilation or writer
 * capability. Evidence output is sanitized: entries carry sanitized inner
 * names, bounded hex only, and no absolute paths beyond the documented
 * main-process `containerPath`.
 */
import { type BridgeRunner } from '../bridge/runBridge.js';
import type { StructuredDiagnostic } from '@soulforge/shared';
export type ScriptEntryClassification = 'lua-bytecode' | 'luagnl' | 'luainfo' | 'esd-bytecode' | 'hkx-bytecode' | 'unknown';
export interface ScriptContainerEntryEvidence {
    /** Entry name sanitized to basename (Sekiro BND4 inner names are absolute
     *  build-machine paths; never surfaced here). */
    name: string;
    /** Entry index in the BND4 entry table (container reference slot). */
    index: number;
    /** Uncompressed size in bytes. */
    size: number;
    /** File extension (lowercase, without dot). */
    extension: string;
    /** Classified entry type (extension-based). */
    classification: ScriptEntryClassification;
    /** First N bytes as hex (readonly evidence, bounded). */
    headerHex?: string;
    /** Magic bytes identification string. */
    magicLabel?: string;
    /** True when the real header bytes of this entry matched the `\x1bLua`
     *  compiled-bytecode family via the bounded magic sample. */
    magicVerified?: boolean;
}
export interface ScriptContainerEvidence {
    ok: boolean;
    /** Container file path (absolute, main-process only). */
    containerPath: string;
    /** Container format: BND4, DCX-DFLT->BND4, BND4_KRAK, or unknown. */
    containerFormat: string;
    /** Total entry count. */
    entryCount: number;
    /** Per-entry evidence (bounded to MAX_EVIDENCE_ENTRIES). */
    entries: ScriptContainerEntryEvidence[];
    /** Whether the entry list was truncated. */
    truncated: boolean;
    /** Distribution of classifications. */
    classificationSummary: Record<ScriptEntryClassification, number>;
    /** Extension distribution across the whole container (lowercase, no dot). */
    extensionDistribution: Record<string, number>;
    /** Count of script entries whose real bytes matched the `\x1bLua` magic. */
    magicVerifiedCount: number;
    /** Count of script-classified entries (lua/luagnl/luainfo/esd/hkx). */
    scriptEntryCount: number;
    /** Number of script entries actually sampled for magic verification. */
    magicSampleCount: number;
    /** Authority marker: container-level inventory only (cap=candidate). */
    authority: 'candidate';
    diagnostics: StructuredDiagnostic[];
}
/**
 * Container evidence must not turn a standalone script into a pretend BND4
 * child. Keep the container-only API explicit and leave source opening to the
 * production `readScriptSource` path.
 */
export declare function buildRequiresContainerEvidence(containerPath: string, containerFormat: string, extensionDistribution?: Record<string, number>): ScriptContainerEvidence;
/**
 * True when `headerBytes` begins with the `\x1bLua` compiled-bytecode
 * signature (family `\x1bLuaP` / `\x1bLuaQ`). Readonly identification —
 * never decompiles or executes.
 */
export declare function isHavokScriptBytecode(headerBytes: number[] | Uint8Array): boolean;
export declare function classifyScriptEntry(name: string, headerBytes?: number[] | Uint8Array): ScriptEntryClassification;
/**
 * Fail-closed load-prerequisite check for a whole-inner-file replacement.
 *
 * Verifies the replaced entry still begins with the `\x1bLua` compiled-bytecode
 * signature (`\x1bLuaP` / `\x1bLuaQ`). A container whose inner script entries
 * lost their bytecode magic is not loadable by the game as a script container,
 * so an anomaly MUST produce an error diagnostic — never a silent pass.
 *
 * This is a structural prerequisite only: it proves the bytecode family magic
 * survived the replacement, never that the game can execute the bytes. Real
 * in-game load requires user confirmation (see the game-load smoke); authority
 * stays `candidate` until then. SoulForge never decompiles, recompiles or
 * generates bytecode.
 */
export declare function checkReplacedEntryMagic(entryLabel: string, headerBytes: number[] | Uint8Array): {
    ok: boolean;
    diagnostics: StructuredDiagnostic[];
};
export declare function magicLabel(classification: ScriptEntryClassification): string;
/**
 * Sanitize a BND4 entry name to its basename. Sekiro luabnd inner names are
 * absolute paths from the original build machine (e.g.
 * `N:\NTC\data\Target\INTERROOT_win64\script\ai\out\bin\goal_list.lua`);
 * surfacing them would leak absolute paths into the editor. On basename
 * collision the index is appended for uniqueness.
 */
export declare function sanitizeEntryName(rawName: string, index: number, seen: Set<string>): string;
export interface ScriptEvidenceOptions {
    containerPath: string;
    allowedRoots: string[];
    oodleRuntimeRoot?: string;
    timeoutMs?: number;
}
/**
 * Build a readonly container-level magic/reference inventory for a script
 * container. Uses the Bridge `inventory-asset-resources` command for the
 * container anchor (format / entryCount / extension distribution), the
 * `list-bnd4-entries` command for the full BND4 reference table when the
 * container is DCX-wrapped, and `snapshot-bnd4-child` for a bounded magic
 * sample over real `.lua`/`.hks` header bytes.
 *
 * Never modifies any file. Never executes or decompiles scripts. Evidence
 * retains only sanitized inner names, bounded hex (first 32 bytes per sampled
 * script entry) and no absolute paths beyond the documented `containerPath`.
 */
export declare function buildScriptContainerEvidence(options: ScriptEvidenceOptions, bridgeRunner?: BridgeRunner): Promise<ScriptContainerEvidence>;
