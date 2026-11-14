import type { Diagnostic } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
export interface SetStandaloneHksSourceInput {
    edit: NativeEditSession;
    file: string;
    text: string;
    expectedSourceHash?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
}
export interface SetStandaloneHksSourceResult {
    ok: boolean;
    filePath?: string;
    scriptName?: string;
    beforeSourceHash?: string;
    afterSourceHash?: string;
    beforeHash?: string;
    afterHash?: string;
    diagnostics: Diagnostic[];
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}
export declare function setStandaloneHksSource(input: SetStandaloneHksSourceInput): Promise<SetStandaloneHksSourceResult>;
