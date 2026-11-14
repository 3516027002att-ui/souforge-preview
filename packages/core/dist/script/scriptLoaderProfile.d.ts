/**
 * Script loader profiles for SoulForge script editing.
 *
 * Enforces resource category, representation, encoding, and first-party
 * compiler/decompiler provenance. Current Sekiro HKS bytecode is source-editable;
 * future dialects must not be silently treated as the current dialect.
 */
import type { PlaintextEncoding } from './plaintextScriptEntry.js';
export type ScriptResourceKind = 'ai-script' | 'action-hks' | 'text-nameid' | 'other';
export type ScriptRepresentation = 'plaintext' | 'bytecode' | 'unknown';
export interface ScriptSyntaxValidator {
    toolName: string;
    targetLuaVersion: string;
    validatorPath?: string;
    /**
     * Run syntax validation on script source.
     * If validator tool is missing or returns non-zero, this must fail.
     */
    validate?: (source: string) => {
        ok: boolean;
        error?: string;
    };
}
export interface ScriptDecompilerTool {
    toolName: string;
    version: string;
    executablePath?: string;
}
export interface ScriptLoaderProfile {
    id: string;
    game: string;
    version?: string;
    resourceKind: ScriptResourceKind;
    containerPattern: RegExp | string;
    entryPattern?: RegExp | string;
    allowedRepresentations: ScriptRepresentation[];
    defaultEncoding: PlaintextEncoding;
    supportsPlaintextSourceEdit: boolean;
    bytecodeToSourceAllowed: boolean;
    matchingSyntaxValidator?: ScriptSyntaxValidator;
    decompilerTool?: ScriptDecompilerTool;
    verifiedSamples: string[];
}
export declare const REGISTERED_SCRIPT_LOADER_PROFILES: readonly ScriptLoaderProfile[];
export declare function resolveScriptLoaderProfile(context: {
    game?: string;
    containerPath?: string;
    entryName?: string;
    isBytecode?: boolean;
}): ScriptLoaderProfile | undefined;
export declare function canEditScriptAsSource(profile: ScriptLoaderProfile | undefined, isBytecode: boolean): {
    allowed: boolean;
    code?: string;
    message?: string;
};
