import type { ReferenceObjectIdentity, ReferencePageRecord, ReferenceQueryInput, SymbolBundle } from '@soulforge/shared';
import { type ProviderBuildOptions } from './referenceProviderRegistry.js';
import type { EmedfRegistry } from '../emevd/emedfSchema.js';
import { type ReferenceCursorStore } from './referenceCursorStore.js';
/** True when any exact handle of this map entity equals the wanted key. */
export declare function mapTargetKeyMatches(entity: {
    uri: string;
    name: string;
    mapId: string;
    internalEntryId?: number;
    entityId?: number;
    nativeOffset?: number;
    address?: string;
}, wantedKey: string): boolean;
export interface ReferenceQueryServiceOptions {
    /** Snapshot bundle of current symbols (workspace index or fixture). */
    bundle: SymbolBundle;
    workspaceId?: string;
    registry?: EmedfRegistry;
    /**
     * Host-provided entity resolver (production: resolveEntity over the real
     * index). The service never runs its own name search (步骤 2). When absent,
     * query resolution falls back to the same exact-identity collector used for
     * `target`, applied over the bundle's indexed symbols — never a deep read.
     */
    resolveQuery?: (query: string, domain?: string) => Promise<{
        resolution: 'resolved' | 'ambiguous' | 'not_found' | 'insufficient_evidence';
        uri?: string;
        candidates?: Array<{
            uri: string;
            label: string;
            discriminators: Record<string, unknown>;
            identity?: ReferenceObjectIdentity;
        }>;
    }>;
    /** Scan caps for cold-shard completion (步骤：并发 ≤2、来源 ≤64). */
    maxSources?: number;
    /** Hard graph traversal caps; they bound multi-hop work independently of page size. */
    maxTraversalNodes?: number;
    maxTraversalEdges?: number;
    /** Host-owned cursor state. Default is a bounded store shared by service instances. */
    cursorStore?: ReferenceCursorStore;
    /** Optional enrichment scan state to include while budgeting the public page. */
    scan?: ReferencePageRecord['scan'];
    /** Enrichment diagnostics are folded into the page before cursor budgeting. */
    sourceDiagnostics?: ReferencePageRecord['diagnostics'];
    buildOptions?: ProviderBuildOptions;
    /**
     * Reference edges the host already built for this bundle (the workspace index caches them per
     * option set). Reusing them avoids rebuilding the whole graph on every query; the service still
     * builds its own shards when hypotheses are requested or extra build options are supplied.
     */
    prebuiltEdges?: readonly import('@soulforge/shared').ReferenceEdge[];
    /** Host-owned coverage certificate; bundle symbols alone never prove completeness. */
    coverageStates?: readonly {
        domain?: string;
        status?: string;
        coveredResources?: number;
        expectedResources?: number | null;
        coveredResourceIds?: readonly string[];
        expectedResourceIds?: readonly string[] | null;
        staleSources?: readonly string[];
        diagnostics?: readonly string[];
    }[];
    /** Active provider/schema contract digest used for shard invalidation. */
    providerRegistryDigest?: string;
}
export interface ReferenceQueryService {
    query(input: ReferenceQueryInput): Promise<ReferencePageRecord>;
    /** Field observations actually delivered to the caller (T09 proof input). */
    deliveredFieldProofs(): Array<{
        sourceUri: string;
        rowId: number;
        rowIndex?: number;
        fieldId: string;
        dataHash?: string;
    }>;
}
export declare function createReferenceQueryService(options: ReferenceQueryServiceOptions): ReferenceQueryService;
