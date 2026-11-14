/**
 * Development/validation-only locator for the community DSLuaDecompiler.
 *
 * This file is intentionally below `src/testing`: it is used only by local
 * differential corpus smokes.  Production reads and writes use the
 * first-party HKS Bridge and must never call this locator or inspect a user's
 * editor installation.
 */
export declare const DS_LUA_DECOMPILER_RELATIVE_CANDIDATES: string[];
export interface DsLuaDecompilerProbe {
    exePath: string | null;
    origin: 'explicit' | 'tools-scan' | 'legacy' | 'none';
}
export interface DsLuaDecompilerLocatorContext {
    baseRoot?: string | null;
    overlayRoot?: string | null;
    gameRootEnv?: string | null;
}
export declare function locateDsLuaDecompilerSync(context?: DsLuaDecompilerLocatorContext): DsLuaDecompilerProbe;
