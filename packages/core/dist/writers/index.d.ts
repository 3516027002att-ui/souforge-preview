export * from './textFileWriter.js';
export * from './rawFileWriter.js';
export * from './containerChildReplaceWriter.js';
export * from './syntheticResourceWriter.js';
export * from './unsupportedResourceWriter.js';
import type { PatchIrOperation, WriterAdapterContract } from '@soulforge/shared';
export declare function createScaffoldWriterAdapters(): WriterAdapterContract[];
/**
 * Resolve the first capable scaffold writer. Falls back to UnsupportedResourceWriter.
 */
export declare function resolveWriterForOperation(operation: PatchIrOperation, writers?: readonly WriterAdapterContract[]): WriterAdapterContract;
