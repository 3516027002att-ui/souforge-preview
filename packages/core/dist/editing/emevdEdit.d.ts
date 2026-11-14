import type { Diagnostic, IndexedFile } from '@soulforge/shared';
import { type DecodedArg, type EmedfRegistry } from '../emevd/emedfSchema.js';
import { type EmevdDslPlanSubmitResult } from './emevdFourViewController.js';
import type { EmevdNativeVerification, EmevdReReadReport, EmevdTransactionStatus } from './emevdPlanCommit.js';
import type { NativeEditSession } from './nativeEditSession.js';
export interface EmevdApplyResult {
    ok: boolean;
    filePath?: string;
    mutationCount?: number;
    /** `noop` is a completed compile with no transaction; it is not a commit. */
    transactionStatus?: EmevdTransactionStatus | 'noop';
    /** Durable operation identity, when the Patch Engine created one. */
    opId?: string;
    outputHash?: string;
    payloadHash?: string;
    outerFileHash?: string;
    committedPath?: string;
    reRead?: EmevdReReadReport;
    nativeVerification?: EmevdNativeVerification;
    error?: {
        code: string;
        message: string;
    };
    diagnostics: Diagnostic[];
}
export interface EmevdReadResult {
    ok: boolean;
    filePath?: string;
    sourceUri?: string;
    /** Hash from the same Bridge native read, not from a cached WorkspaceIndex file. */
    sourceHash?: string;
    /** Outer container hash when the file is a .dcx; same value the write CAS compares. */
    outerFileHash?: string;
    /** Content-derived revision; usable as the write receipt for a create. */
    sourceRevision?: number;
    events?: Array<{
        eventId: number;
        restBehavior: number;
        instructionCount: number;
    }>;
    error?: {
        code: string;
        message: string;
    };
    diagnostics: Diagnostic[];
}
export type EmevdEventReadFormat = 'darkscript' | 'json';
/**
 * Preserve the Patch Engine receipt across the facade boundary. In
 * particular, a post-commit native re-read failure is not the same as a
 * transaction that never changed the file: both retain opId, but only the
 * former has transactionStatus=committed and a committedPath.
 */
export declare function projectEmevdSubmitResult(filePath: string, registryDiagnostics: readonly Diagnostic[], result: EmevdDslPlanSubmitResult): EmevdApplyResult;
export interface EmevdEventInstructionReadDto {
    index: number;
    bank: number;
    id: number;
    argsBase64: string;
    /** True for source-marked unknowns, missing EMEDF definitions, or failed decoding. */
    unknown: boolean;
    emedfName?: string;
    typedArgs?: DecodedArg[];
    diagnostics: Array<{
        severity: 'warning' | 'info';
        code: string;
        message: string;
    }>;
}
export interface EmevdEventReadDto {
    ok: true;
    sourceUri: string;
    sourcePath: string;
    filePath: string;
    eventId: number;
    restBehavior: number;
    /** Total number of native instructions in the selected event. */
    instructionCount: number;
    /** Total number of native instructions represented by this response. */
    total: number;
    /** Effective zero-based offset of `instructions` within the event. */
    offset: number;
    /** Effective instruction window size requested for this response. */
    limit: number;
    /** Number of instruction DTOs included in this response. */
    returned: number;
    /** True when instructions remain after this response window. */
    truncated: boolean;
    /** DarkScript is safe to feed back into apply only when this is true. */
    darkScriptComplete: boolean;
    /** Effective instruction window read range: [start, end). */
    readRange?: {
        start: number;
        end: number;
    } | undefined;
    /** True when the paged slice does not align with or splits condition groups or basic blocks. */
    crossesBlockBoundary?: boolean | undefined;
    /** Basic blocks within this event or window. */
    blocks?: Array<{
        index: number;
        start: number;
        end: number;
        conditionGroup?: number | undefined;
    }> | undefined;
    sourceHash?: string;
    outerFileHash?: string;
    sourceRevision?: number;
    /**
     * What sourceRevision is derived from. `content-hash` means the same bytes always produce the same
     * revision (a write+rollback that restores content keeps the identity valid); `mtime` is the legacy
     * value used only when no content hash was available.
     */
    sourceRevisionKind?: 'content-hash' | 'mtime';
    game: string;
    resourceKind: 'event';
    registryOrigin: EmedfRegistry['origin'];
    registryFingerprint: string;
    registry: {
        origin: EmedfRegistry['origin'];
        fingerprint: string;
        packageId?: string;
        packageVersion?: string;
        contentDigest?: `sha256:${string}`;
    };
    registryPackageId?: string;
    registryPackageVersion?: string;
    registryContentDigest?: `sha256:${string}`;
    format: EmevdEventReadFormat;
    darkScript?: string;
    instructions: EmevdEventInstructionReadDto[];
    diagnostics: Diagnostic[];
}
export interface EmevdEventReadFailure {
    ok: false;
    sourceUri?: string;
    filePath?: string;
    eventId?: number;
    error: {
        code: string;
        message: string;
    };
    diagnostics: Diagnostic[];
}
export type EmevdEventReadResult = EmevdEventReadDto | EmevdEventReadFailure;
export interface EmevdInstructionSearchMatch {
    sourceUri: string;
    eventId: number;
    instructionIndex: number;
    instruction: EmevdEventInstructionReadDto;
    sourceHash?: string;
    outerFileHash?: string;
    authority: 'native-verified-event' | 'native-read-event';
}
export interface EmevdInstructionSearchResult {
    ok: true;
    query: string;
    matches: EmevdInstructionSearchMatch[];
    offset: number;
    limit: number;
    returned: number;
    scannedFiles: number;
    scannedEvents: number;
    complete: boolean;
    truncated: boolean;
    diagnostics: Diagnostic[];
}
export interface EmevdInstructionSearchFailure {
    ok: false;
    query: string;
    error: {
        code: string;
        message: string;
    };
    diagnostics: Diagnostic[];
}
export type EmevdInstructionSearchResponse = EmevdInstructionSearchResult | EmevdInstructionSearchFailure;
/**
 * Only precise instruction names and bounded numeric identifiers may trigger
 * a native cross-file scan. Chinese behavior phrases remain discovery/RAG
 * queries and must not cause an unbounded native read of the workspace.
 */
export declare function isPreciseEmevdInstructionQuery(query: string): boolean;
/**
 * Scan each indexed EMEVD file once, reusing its assembled full document for
 * all events. The full document stays inside this core facade; the Agent only
 * receives matching instruction DTOs plus native identity and diagnostics.
 */
export declare function searchEmevdInstructionMatches(input: {
    edit: NativeEditSession;
    files: readonly IndexedFile[];
    query: string;
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
}): Promise<EmevdInstructionSearchResponse>;
/**
 * Read one event through the native full-document path and return only an
 * event-level Agent DTO. The full editor document never crosses this facade.
 */
export declare function readEmevdEvent(input: {
    edit: NativeEditSession;
    file: string;
    eventId: number;
    format?: EmevdEventReadFormat;
    /** Zero-based event-instruction offset. Defaults to the first instruction. */
    instructionOffset?: number;
    /** Maximum number of event instructions to return. Omitted uses the bounded default. */
    instructionLimit?: number;
    signal?: AbortSignal;
}): Promise<EmevdEventReadResult>;
export declare function readEmevdOutline(input: {
    edit: NativeEditSession;
    file: string;
}): Promise<EmevdReadResult>;
export declare function applyEmevdDsl(input: {
    edit: NativeEditSession;
    file: string;
    dsl: string;
    mode?: 'patch' | 'dark-script';
    /** Canonical event-scoped DarkScript target. */
    scopeEventId?: number;
    /** Short alias accepted by Agent callers. */
    eventId?: number;
    /** Structured alias for callers that model scope explicitly. */
    scope?: {
        eventId: number;
    };
    /**
     * Explicit create intent: the scoped event must NOT exist yet. Without it a
     * missing scope event is an edit of the wrong target, not a request to author
     * a new one.
     */
    createIfMissing?: boolean;
    /** Optional read receipt used to reject a stale model edit before commit. */
    sourceHash?: string;
    outerFileHash?: string;
    sourceRevision?: number;
    /** False means the supplied DarkScript was only an instruction page. */
    darkScriptComplete?: boolean;
}): Promise<EmevdApplyResult>;
/**
 * Content-derived sourceRevision for EMEVD.
 *
 * The identity four-tuple (sourceHash, outerFileHash, sourceRevision, darkScriptComplete) used to carry
 * a file mtime, so two rounds could see the same sha256 with different revisions: any write+rollback
 * changes mtime even though the bytes (and hashes) return to the same value, and a read taken before
 * the round was then refused as stale for no content reason. Deriving the number from the content hash
 * makes identical bytes keep the identical revision in every process. The hash remains authoritative;
 * this number is only the cheap equality token. 48 bits keeps it a safe integer.
 */
export declare function contentRevisionFromHash(hash: string | undefined): number | undefined;
