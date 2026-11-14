import { type Diagnostic } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
export interface FmgEntryEdit {
    table: string;
    id: number;
    text: string | null;
    slotIndex?: number;
}
export interface FmgEntrySnapshot {
    table: string;
    id: number;
    text: string | null;
    slotIndex?: number;
    /** Provenance returned by the same native catalog read. */
    sourceHash?: string;
    sourceRevision?: number;
}
export interface FmgEditFailure {
    code: string;
    message: string;
    details?: unknown;
}
export type FmgReadResult = {
    ok: true;
    containerPath: string;
    table: string;
    entries: FmgEntrySnapshot[];
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: FmgEditFailure;
    diagnostics: Diagnostic[];
};
export type FmgSetResult = {
    ok: true;
    containerPath: string;
    before: FmgEntrySnapshot[];
    after: FmgEntrySnapshot[];
    diagnostics: Diagnostic[];
    opId?: string;
} | {
    ok: false;
    error: FmgEditFailure;
    diagnostics: Diagnostic[];
    before?: FmgEntrySnapshot[];
};
export declare function groupFmgEdits(edits: FmgEntryEdit[]): Map<string, FmgEntryEdit[]>;
export declare function readFmgEntries(input: {
    edit: NativeEditSession;
    table: string;
    ids: number[];
    containerPath?: string;
    lang?: string;
}): Promise<FmgReadResult>;
/** 整表条目集的一页：条目按原生表内序号排列，页面自述它覆盖了哪个序号区间。 */
export interface FmgEntryPageRow extends FmgEntrySnapshot {
    entryIndex: number;
}
export type FmgEntryPageResult = {
    ok: true;
    containerPath: string;
    table: string;
    entryCount: number;
    entryOffset: number;
    entryLimit: number;
    entryReturned: number;
    hasMore: boolean;
    nextOffset?: number;
    entries: FmgEntryPageRow[];
    sourceHash?: string;
    sourceRevision?: number;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: FmgEditFailure;
    diagnostics: Diagnostic[];
};
/**
 * 整表条目集的一页：只由能自述「这一页覆盖整表哪些条目序号 + 全表共多少条目」的读取铸造
 * 容器级证明。`read_fmg_entries` 的 ids 读一次只交付调用方点名的条目，无法证明整表，
 * 因此新增条目的回退授权必须来自这里的分页枚举。
 */
export declare function readFmgEntryPage(input: {
    edit: NativeEditSession;
    table: string;
    containerPath?: string;
    lang?: string;
    offset?: number;
    limit?: number;
}): Promise<FmgEntryPageResult>;
export declare function setFmgEntries(input: {
    edit: NativeEditSession;
    edits: FmgEntryEdit[];
    containerPath?: string;
    lang?: string;
}): Promise<FmgSetResult>;
