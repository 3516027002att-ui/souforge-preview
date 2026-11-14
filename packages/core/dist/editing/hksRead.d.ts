/**
 * Read one standalone Lua/HKS source file.
 *
 * This facade deliberately has no write side effect.  A `.hks`/`.lua` file
 * found by the workspace index is either decoded as plaintext (with the
 * existing plaintext classifier/encoder) or handed to the first-party Bridge
 * HKS reader when its real bytes carry the Lua bytecode signature.  BND/EMEVD
 * containers are not accepted here; their container-specific readers remain
 * separate tools.
 */
import type { Diagnostic, StructuredDiagnostic } from '@soulforge/shared';
import { type PlaintextEncoding } from '../script/plaintextScriptEntry.js';
import type { NativeEditSession } from './nativeEditSession.js';
/** Maximum standalone source payload accepted by this read-only facade. */
export declare const HKS_MAX_SOURCE_BYTES: number;
export declare const HKS_DEFAULT_TIMEOUT_MS = 120000;
export type HksSourceRepresentation = 'plaintext' | 'bytecode';
export interface HksNativeReadRequest {
    filePath: string;
    resourceUri: string;
    allowedRoots: string[];
    workspaceSessionId?: string;
    oodleRuntimeRoot?: string;
    timeoutMs: number;
    signal: AbortSignal;
    /** Exact bytes classified by this helper, encoded for the Bridge request. */
    contentBase64: string;
}
export interface HksNativeReadResponse {
    data?: unknown;
    /** BridgeResult contract: read-hks-source is `ok` or `failed`, never a partial page. */
    parseStatus: string;
    diagnostics?: readonly (Diagnostic | StructuredDiagnostic)[];
}
/** Dependency-injection seam for tests; production delegates to runBridge. */
export type HksNativeReader = (request: HksNativeReadRequest) => Promise<HksNativeReadResponse>;
export interface HksSourceReadSuccess {
    ok: true;
    /** Canonical logical URI, e.g. `file://action/script/c0000.hks`. */
    sourceUri: string;
    /** Alias consumed by source-window projections; equal to sourceUri. */
    logicalSource: string;
    /** Absolute path is core-side evidence only; renderer projections must omit it. */
    sourcePath: string;
    relativePath: string;
    logicalName: string;
    sourceHash: string;
    sourceText: string;
    representation: HksSourceRepresentation;
    encoding: PlaintextEncoding | 'utf8';
    diagnostics: StructuredDiagnostic[];
}
export interface HksSourceReadFailure {
    ok: false;
    code: string;
    message: string;
    sourceUri?: string;
    sourcePath?: string;
    diagnostics: StructuredDiagnostic[];
}
export type HksSourceReadResult = HksSourceReadSuccess | HksSourceReadFailure;
export interface ReadHksSourceInput {
    edit: NativeEditSession;
    /** Absolute or overlay-relative path. The registry resolves indexed tokens before calling. */
    file: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    nativeReader?: HksNativeReader;
}
export declare function readHksSource(input: ReadHksSourceInput): Promise<HksSourceReadResult>;
