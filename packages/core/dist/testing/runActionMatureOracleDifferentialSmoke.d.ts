/**
 * Real ACTION differential against the external SoulsAssetPipeline runtime.
 *
 * The oracle is intentionally not a dependency of SoulForge and is never
 * loaded by production code. A short-lived PowerShell reflection process
 * invokes the installed GPL tool against the user's real c0000 corpus and
 * returns only hashes, metadata, binding identity, and sampled transforms.
 * The repository contains no oracle source, DLL, or game bytes.
 */
export declare function runActionMatureOracleDifferentialSmoke(): Promise<void>;
