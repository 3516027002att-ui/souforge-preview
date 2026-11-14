import { type EvidenceClaim, type EvidenceIdentity, type EvidenceVersion } from '../../../model-services/evidenceIdentity.js';
export declare function makeIdentity(options?: {
    outer?: string;
    childChain?: readonly string[];
    domain?: string;
    namespace?: string;
    objectHandle?: string;
    propertyKey?: string;
    language?: string;
    formatProfileId?: string;
}): EvidenceIdentity;
export declare function makeVersion(options?: Partial<EvidenceVersion>): EvidenceVersion;
export declare function makeClaim(identity: EvidenceIdentity, options?: {
    text?: string;
    handle?: string;
    version?: EvidenceVersion;
    authority?: number;
    authorityClass?: EvidenceClaim['authorityClass'];
    required?: boolean;
    relevance?: number;
    sequence?: number;
    dependencyRole?: EvidenceClaim['dependencyRole'];
    goalRefs?: readonly string[];
    title?: string;
}): EvidenceClaim;
export declare function currentVersionMap(claims: readonly EvidenceClaim[]): ReadonlyMap<string, EvidenceVersion>;
