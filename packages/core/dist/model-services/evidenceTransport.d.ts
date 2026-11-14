import { type EvidenceClaim, type EvidenceIdentity } from './evidenceIdentity.js';
/** Lossless envelope-local defaults; omitted keys are derivable, never truncated. */
export type TransportClaim = Omit<Partial<EvidenceClaim>, 'identity'> & {
    identity?: Partial<EvidenceIdentity>;
};
export interface EvidenceClaimsTransport {
    claims?: TransportClaim[];
    claimDefaults?: TransportClaim;
}
export declare function encodeEvidenceClaims(claims: EvidenceClaim[]): EvidenceClaimsTransport;
/** Also accepts historical full claims. Validation/requiredness stays with the host. */
export declare function expandEvidenceClaims(evidence: unknown): unknown[];
