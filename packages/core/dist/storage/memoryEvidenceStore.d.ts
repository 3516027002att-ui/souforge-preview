import type { EventExport, IndexedFile, MapExport, MsgExport, ParamExport, ReferenceEdge, ResourceKind, SymbolBundle } from '@soulforge/shared';
import type { SearchResult } from '../indexing/workspaceIndex.js';
export interface WorkspaceRecord {
    workspaceId: string;
    rootPath: string;
    game: string;
    createdAt: string;
    updatedAt: string;
}
export interface EvidenceStoreSearchOptions {
    query: string;
    kinds?: readonly ResourceKind[];
    limit?: number;
}
export interface EvidenceStoreSymbols {
    events: EventExport[];
    maps: MapExport[];
    params: ParamExport[];
    msgs: MsgExport[];
}
export interface EvidenceStore {
    upsertWorkspace(workspace: WorkspaceRecord): void;
    getWorkspace(workspaceId: string): WorkspaceRecord | undefined;
    replaceFiles(workspaceId: string, files: readonly IndexedFile[]): void;
    getFiles(workspaceId: string): IndexedFile[];
    searchFiles(workspaceId: string, options: EvidenceStoreSearchOptions): Array<SearchResult<IndexedFile>>;
    replaceSymbols(workspaceId: string, symbols: SymbolBundle): void;
    getSymbols(workspaceId: string): EvidenceStoreSymbols;
    replaceReferences(workspaceId: string, references: readonly ReferenceEdge[]): void;
    findReferences(workspaceId: string, uri: string, direction?: 'from' | 'to' | 'both'): ReferenceEdge[];
}
export declare class MemoryEvidenceStore implements EvidenceStore {
    private readonly workspaces;
    private readonly filesByWorkspace;
    private readonly symbolsByWorkspace;
    private readonly referencesByWorkspace;
    upsertWorkspace(workspace: WorkspaceRecord): void;
    getWorkspace(workspaceId: string): WorkspaceRecord | undefined;
    replaceFiles(workspaceId: string, files: readonly IndexedFile[]): void;
    getFiles(workspaceId: string): IndexedFile[];
    searchFiles(workspaceId: string, options: EvidenceStoreSearchOptions): Array<SearchResult<IndexedFile>>;
    replaceSymbols(workspaceId: string, symbols: SymbolBundle): void;
    getSymbols(workspaceId: string): EvidenceStoreSymbols;
    replaceReferences(workspaceId: string, references: readonly ReferenceEdge[]): void;
    findReferences(workspaceId: string, uri: string, direction?: 'from' | 'to' | 'both'): ReferenceEdge[];
}
