/**
 * Provenance chain model (architecture fork #105).
 * Every field, reference, diagnostic, and patch should be able to attach provenance.
 *
 * Synthetic fixtures must never claim native format authority.
 */
import type { ContentHash } from './resource-uri.js';
export type ProvenanceSourceKind = 'evidence' | 'parser' | 'synthetic_fixture' | 'user_confirmation' | 'validator' | 'tool_call' | 'index' | 'user_edit' | 'system';
export interface ProvenanceSource {
    kind: ProvenanceSourceKind;
    /** Stable id of the producer (parser name, tool name, fixture id, etc.). */
    id: string;
    label?: string;
    /** When this provenance was recorded (ISO-8601). */
    recordedAt?: string;
    /** Optional content hash of the source blob. */
    contentHash?: ContentHash;
    /**
     * True only when a real native format parser produced this claim.
     * Synthetic fixtures and heuristics must set this to false.
     */
    nativeFormatAuthority: boolean;
    /** True when this came from a synthetic test fixture. */
    syntheticFixture: boolean;
    details?: Record<string, unknown>;
}
export interface ProvenanceLink {
    fromSourceId: string;
    toSourceId: string;
    relation: 'derived_from' | 'confirmed_by' | 'validated_by' | 'contradicted_by' | 'superseded_by';
}
/**
 * Ordered provenance chain. First entry is typically the origin.
 */
export interface ProvenanceChain {
    sources: ProvenanceSource[];
    links?: ProvenanceLink[];
}
export interface ProvenanceAttachment {
    targetUri: string;
    chain: ProvenanceChain;
}
export declare function createProvenanceSource(partial: Omit<ProvenanceSource, 'nativeFormatAuthority' | 'syntheticFixture'> & {
    nativeFormatAuthority?: boolean;
    syntheticFixture?: boolean;
}): ProvenanceSource;
export declare function createSyntheticFixtureProvenance(fixtureId: string, label?: string): ProvenanceSource;
export declare function createParserProvenance(parserId: string, options?: {
    nativeFormatAuthority?: boolean;
    syntheticFixture?: boolean;
    label?: string;
    details?: Record<string, unknown>;
}): ProvenanceSource;
export declare function assertNoSyntheticNativeAuthority(source: ProvenanceSource): void;
export declare function provenanceClaimsNativeAuthority(chain: ProvenanceChain): boolean;
