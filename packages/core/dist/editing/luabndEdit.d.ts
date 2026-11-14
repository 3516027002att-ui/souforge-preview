import type { Diagnostic } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
export interface LuabndScriptSnapshot {
    sanitizedName: string;
    size: number;
    uncompressedSize: number;
    contentHash: string;
    outerFileHash?: string;
    isBytecode: boolean;
    magic: string;
    variant: string;
    isPlainText: boolean;
    embeddedSymbols: string[];
    textPreview?: string | undefined;
    sourceHash: string;
    representation?: 'plaintext' | 'bytecode' | 'unknown' | undefined;
    detectedEncoding?: string | undefined;
    canWriteBack?: boolean | undefined;
    derivedSource?: string | undefined;
    decompilerVersion?: string | undefined;
    warnings?: string[] | undefined;
    loaderProfileId?: string | undefined;
    /** Complete first-party decompiled source for current Sekiro HKS bytecode. */
    sourceText?: string | undefined;
    dialect?: string | undefined;
    compilerProvenance?: {
        origin: 'first-party';
        package: string;
        revision: string;
    } | undefined;
    decompilerProvenance?: {
        origin: 'first-party';
        package: string;
        revision: string;
    } | undefined;
    /** A child-less read is a directory/catalog view, never script content. */
    status?: 'catalog-only' | 'native-read';
}
export interface LuabndEditFailure {
    code: string;
    message: string;
    details?: unknown | undefined;
}
export type LuabndReadResult = {
    ok: true;
    containerPath: string;
    script: LuabndScriptSnapshot;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: LuabndEditFailure;
    diagnostics: Diagnostic[];
};
export type LuabndListResult = {
    ok: true;
    containerPath: string;
    sourceUri: string;
    outerFileHash: string;
    sourceRevision: number;
    catalogComplete: boolean;
    entryCount: number;
    scriptCount: number;
    scripts: Array<{
        name: string;
        sanitizedName: string;
        size: number;
        isBytecode: boolean;
        contentKind: 'source' | 'bytecode' | 'catalog-only';
        contentHash?: string;
        embeddedSymbolsSample?: string[];
    }>;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: LuabndEditFailure;
    diagnostics: Diagnostic[];
};
export type LuabndSetResult = {
    ok: true;
    containerPath: string;
    childPath: string;
    beforeHash: string;
    afterHash: string;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: LuabndEditFailure;
    diagnostics: Diagnostic[];
};
export declare function listLuabndScripts(input: {
    edit: NativeEditSession;
    file: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<LuabndListResult>;
export declare function readLuabndScript(input: {
    edit: NativeEditSession;
    file: string;
    childPath?: string;
    expectedContainerHash?: string;
    expectedChildHash?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<LuabndReadResult>;
export declare function setLuabndScript(input: {
    edit: NativeEditSession;
    file: string;
    childPath: string;
    text?: string;
    contentBase64?: string;
    expectedContainerHash?: string;
    expectedChildHash?: string;
}): Promise<LuabndSetResult>;
