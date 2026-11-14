/**
 * FLVER header candidate probe (read-only).
 * Does not claim mesh decode or writer authority — only magic/version/envelope.
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
export interface FlverMeshTableEntry {
    index: number;
    /** Absolute offset of mesh header row inside the file (candidate layout). */
    headerOffset: number;
    /** Raw fields preserved for later FLVER decoder — not claimed as final schema. */
    field0: number;
    field1: number;
    field2: number;
    field3: number;
}
export interface FlverCandidateReport {
    authority: 'unsupported' | 'candidate';
    magic: string;
    version?: number;
    dataOffset?: number;
    dataLength?: number;
    dummyCount?: number;
    materialCount?: number;
    boneCount?: number;
    meshCount?: number;
    /** Candidate mesh table rows (bounded). */
    meshes?: FlverMeshTableEntry[];
    contentHash: string;
    byteLength: number;
    diagnostics: StructuredDiagnostic[];
}
/**
 * Probe FLVER / FLVER2-like headers without full mesh parse.
 */
export declare function probeFlverCandidate(bytes: Buffer): FlverCandidateReport;
/** Minimal synthetic FLVER2-like header for fixture smoke (not game asset). */
export declare function buildSyntheticFlverHeaderFixture(options?: {
    meshCount?: number;
    materialCount?: number;
    boneCount?: number;
}): Buffer;
