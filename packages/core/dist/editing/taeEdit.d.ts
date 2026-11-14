import type { Diagnostic, TaeEntryWire, TaeExport } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
import type { TaeBrowseAction } from './taeBrowse.js';
export declare const TAE_FPS = 30;
export interface TaeEventSnapshot {
    chrId: string;
    animId: number;
    code: string;
    eventIndex: number;
    uri: string;
    address: string;
    eventTypeId: number;
    typeName?: string;
    startTime: number;
    endTime: number;
    startFrame: number;
    endFrame: number;
    taeEntryIndex?: number;
    taeEntryId?: number;
    taeEntryName?: string;
    taeGroup?: string;
    schemaBankId?: number;
    schemaVariant?: string;
    parameterDecoded?: boolean;
    parameterTailLength?: number;
    fields?: Array<{
        name: string;
        /** The same value as `name`; the write-side selector (`mutate_tae_event_fields`). */
        fieldName?: string;
        value: string | number | boolean;
        kind?: string;
        index?: number;
        type?: string;
        offset?: number;
        size?: number;
        isPadding?: boolean;
        assert?: number;
        assertValid?: boolean;
        enumEntries?: Array<{
            value: number;
            name: string;
        }>;
        rawValue?: number;
        displayValue?: string;
    }>;
    parameterBytesHex?: string;
    decodeStatus?: 'decoded' | 'partial' | 'unknown';
    raw?: {
        eventTypeId: number;
        startTime: number;
        endTime: number;
        parameterBytesHex?: string;
    };
}
export interface TaeEventTimeEdit {
    /** `c1050#A0200.e0`。 */
    address: string;
    startFrame?: number;
    endFrame?: number;
}
export interface TaeEventFieldEdit {
    /** `c1050#A0200.e0`，也可使用带 TAE section 的 canonical action URI。 */
    address: string;
    fieldIndex?: number;
    fieldName?: string;
    /** `name` 的别名（read_tae_events 早期只返回这个键）；与 fieldName 同义。 */
    name?: string;
    value: string | number | boolean;
}
export interface TaeEditFailure {
    code: string;
    message: string;
    details?: unknown;
}
export interface TaeActionSnapshot {
    chrId: string;
    animId: number;
    code: string;
    address: string;
    eventCount: number;
    taeEntryIndex?: number;
    taeEntryId?: number;
    taeEntryName?: string;
    taeGroup?: string;
}
export type TaeReadResult = {
    ok: true;
    filePath: string;
    chrId: string;
    readerSchemaRevision: number;
    sourceHash?: string;
    outerFileHash?: string;
    containerSourceHash?: string;
    animationCount?: number;
    totalEventCount?: number;
    status?: 'partial' | 'complete';
    eventsTruncated?: boolean;
    nativePagination?: {
        animationPage: number;
        animationPageSize: number;
        returnedCount: number;
        totalCount: number | null;
        hasMore: boolean;
    };
    taeEntryCount?: number;
    taeEntries?: TaeEntryWire[];
    actions: Array<TaeActionSnapshot | TaeBrowseAction>;
    events: TaeEventSnapshot[];
    pagination: {
        returnedCount: number;
        totalCount: number | null;
        offset: number;
        hasMore: boolean;
        nextCursor: string | null;
        pageNumber?: number;
        totalPages?: number | null;
    };
    /** Set when the page was read for the compact projection (requested, or carried by the cursor). */
    projection?: 'compact';
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: TaeEditFailure;
    diagnostics: Diagnostic[];
};
export type TaeSetResult = {
    ok: true;
    filePath: string;
    before: TaeEventSnapshot[];
    after: TaeEventSnapshot[];
    mutations: number;
    diagnostics: Diagnostic[];
    opId?: string;
    backupRoot?: string;
    nativeVerified: boolean;
} | {
    ok: false;
    error: TaeEditFailure;
    diagnostics: Diagnostic[];
    before?: TaeEventSnapshot[];
};
export declare function frameFromSeconds(seconds: number): number;
export declare function secondsFromFrame(frame: number): number;
export declare function readTaeEvents(input: {
    edit: NativeEditSession;
    file: string;
    addresses?: string[];
    cursor?: string;
    offset?: number;
    pageSize?: number;
    /** Fixed pages of up to TAE_COMPACT_PAGE_SIZE events, numbered like search_tae_events previews (#52). */
    projection?: 'compact';
    expectedSourceHash?: string;
    expectedReaderSchemaRevision?: number;
}): Promise<TaeReadResult>;
export interface TaeScanResult {
    ok: true;
    filePath: string;
    /** Every action and event of the source, in the indexed symbol shape plus the field metadata the compact
     * projection uses (padding, assert, schema index, enum label); layout offsets, enum tables and raw copies are left out. */
    export: TaeExport;
    stats: {
        pages: number;
        animations: number;
        events: number;
        completedTails: number;
        tailSkipped?: number;
    };
    /** Actions whose whole event list could not be read. They stay in the export with their preview events only. */
    incompleteActions?: string[];
    incompleteActionCount?: number;
    /** True when the scan returned usable but incomplete evidence (unreadable action tail or unreadable later page). */
    partial?: true;
    diagnostics: Diagnostic[];
}
/** Read a whole TAE source page by page for a native action search (#52), keeping only the searchable projection
 * of each page. Animations whose page truncates their events are read whole by address. The source version must
 * stay the same across every call; a version change or a cancelled scan is returned as a failure, while an action
 * that cannot be read whole degrades to `partial` evidence instead of discarding the rest of the file. */
export declare function scanTaeExport(input: {
    edit: NativeEditSession;
    file: string;
    sourceUri: string;
    signal?: AbortSignal;
    onPage?: (progress: {
        pages: number;
        animations: number;
    }) => void;
}): Promise<TaeScanResult | TaeEditFailureResult>;
type TaeEditFailureResult = {
    ok: false;
    error: TaeEditFailure;
    diagnostics: Diagnostic[];
};
export declare function setTaeEventTimes(input: {
    edit: NativeEditSession;
    file: string;
    edits: TaeEventTimeEdit[];
}): Promise<TaeSetResult>;
/**
 * Write first-party decoded TAE fields.  The caller may address a field by
 * its stable schema index or by the schema field name.  Padding/assert fields
 * are intentionally rejected; their original bytes remain part of the
 * native document and are preserved by the Bridge writer.
 */
export declare function setTaeEventFields(input: {
    edit: NativeEditSession;
    file: string;
    edits: TaeEventFieldEdit[];
}): Promise<TaeSetResult>;
export interface TaeEventInsertion {
    address: string;
    eventTypeId: number;
    startFrame: number;
    endFrame: number;
    template: {
        file?: string;
        address: string;
    };
    fields?: Array<{
        fieldIndex?: number;
        fieldName?: string;
        value: string | number | boolean;
    }>;
}
/** Where a `template.file` token ultimately points. `target` means the template lives in the
 *  document being written, which is what an omitted `file` promises. */
export type TaeTemplateSource = {
    kind: 'target';
} | {
    kind: 'container';
    path: string;
} | {
    kind: 'unresolved';
};
/**
 * Two spellings of one container are one document; a container read twice would report a
 * different sourceHash for the same bytes. Windows paths fold case (the filesystem does),
 * POSIX ones do not.
 */
export declare function sameTaeDocumentPath(left: string, right: string): boolean;
/**
 * Which addresses the target document must deliver before a template can be resolved.
 * A template address is only readable from the target document when the template lives there —
 * including the case where `template.file` merely repeats the target file. Excluding it whenever
 * `file` was present made that spelling search a document that never held the template, so the
 * documented `{file, address}` failed as TAE_TEMPLATE_NOT_FOUND while the same call without
 * `file` succeeded.
 */
export declare function taeTargetReadAddresses(events: ReadonlyArray<{
    address: string;
    template?: {
        file?: string;
        address?: string;
    };
}>, sources: ReadonlyArray<TaeTemplateSource>, targetPath: string): string[];
/**
 * Resolve every named template container once, before the target document is read: the same path
 * decides what the target read must deliver and whether a second document is read, and those two
 * decisions have to agree. `files` keeps the resolution so the staging loop reuses it instead of
 * resolving a second time (a file that changed meaning in between would stage the wrong bytes).
 */
export declare function prepareTaeTemplateSources(edit: NativeEditSession, events: ReadonlyArray<TaeEventInsertion>): Promise<{
    files: Array<{
        ok: true;
        path: string;
    } | {
        ok: false;
        error: {
            code: string;
            message: string;
        };
    } | undefined>;
    sources: TaeTemplateSource[];
}>;
/** Host-resolved templates; Bridge owns byte layout and typed-field validation. */
export declare function insertTaeEvents(input: {
    edit: NativeEditSession;
    file: string;
    events: TaeEventInsertion[];
}): Promise<{
    ok: false;
    error: {
        code: string;
        message: string;
    };
    diagnostics: Diagnostic[];
} | {
    before: TaeEventSnapshot[];
    after: TaeEventSnapshot[];
    mutations: number;
    nativeVerified: boolean;
    opId: string | undefined;
    backupRoot: string | undefined;
    rollback: {
        tool: string;
        args: {
            opId: string | undefined;
        };
    };
    diagnostics: Diagnostic[];
    afterHash?: string;
    ok: true;
    filePath: string;
    sourceUri: string;
    beforeHash: string;
}>;
export {};
