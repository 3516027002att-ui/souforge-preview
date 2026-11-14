/**
 * High-level container APIs: inspect tree, list/read/replace children,
 * roundtrip, nested DCX(BND).
 */
import type { StructuredDiagnostic } from '@soulforge/shared';
import { buildSyntheticBnd, isSyntheticBnd, readSyntheticBnd } from './bndSynthetic.js';
import type { ChildBytesResult, ContainerChild, ContainerFormat, ContainerReadResult, ContainerRoundTripReport, ReplaceChildResult } from './containerIr.js';
import { buildUnsupportedDcxStub, compressDcxDflt, decompressDcx } from './dcx.js';
/**
 * Inspect a container file into a ContainerTree (recursive for DCX→BND).
 */
export declare function inspectContainerTree(absolutePath: string, options?: {
    relativePath?: string;
    maxDepth?: number;
}): Promise<ContainerReadResult>;
export declare function listContainerChildren(absolutePath: string, options?: {
    relativePath?: string;
    recursive?: boolean;
}): Promise<{
    ok: boolean;
    children: ContainerChild[];
    diagnostics: StructuredDiagnostic[];
}>;
export declare function readContainerChild(absolutePath: string, childUri: string, options?: {
    relativePath?: string;
}): Promise<ChildBytesResult>;
/**
 * Replace a child and rebuild the outer container (in-memory).
 * Supports: synthetic BND, DCX(DFLT) wrapping synthetic BND.
 */
export declare function replaceContainerChildInMemory(containerBytes: Buffer, childSelector: string, newChildBytes: Buffer, expectedContainerHash: string, expectedChildHash: string): ReplaceChildResult;
export declare function roundTripContainer(absolutePath: string): Promise<ContainerRoundTripReport>;
export declare function validateContainer(absolutePath: string): Promise<{
    ok: boolean;
    format: ContainerFormat;
    diagnostics: StructuredDiagnostic[];
    report?: ContainerRoundTripReport;
}>;
export declare function exportContainerTree(absolutePath: string, outputDirectory: string, options?: {
    relativePath?: string;
}): Promise<{
    ok: boolean;
    exported: string[];
    diagnostics: StructuredDiagnostic[];
}>;
/** Test helpers re-export */
export { buildSyntheticBnd, compressDcxDflt, buildUnsupportedDcxStub, decompressDcx, isSyntheticBnd, readSyntheticBnd };
