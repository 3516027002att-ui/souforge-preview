/**
 * Resolve the production EMEVD semantic registry.
 *
 * Production deliberately has one source of schema truth: the versioned,
 * content-addressed SoulForge first-party package. The optional argument is
 * retained only as a compatibility boundary for old callers; it is rejected
 * with a structured diagnostic and is never read from disk.
 *
 * The C# Bridge remains the authority for native EMEVD bytes. This registry
 * only supplies the semantic instruction/argument vocabulary used by the
 * TypeScript projection and typed mutation layers.
 */
import { type EmedfRegistry } from './emedfSchema.js';
export interface EmedfResolutionDiagnostic {
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    details?: unknown;
}
export declare const EMEVD_EXTERNAL_SCHEMA_FORBIDDEN_CODE = "EMEVD_EXTERNAL_SCHEMA_FORBIDDEN";
export type ProductionEmedfOrigin = 'first-party' | 'fixture';
export interface EmedfResolutionResult {
    registry: EmedfRegistry;
    origin: ProductionEmedfOrigin;
    instructionCount: number;
    bankCount: number;
    packageId?: string;
    packageVersion?: string;
    contentDigest?: `sha256:${string}`;
    diagnostics: EmedfResolutionDiagnostic[];
    /** True when a legacy external schema argument was explicitly rejected. */
    externalSchemaRejected?: boolean;
    /** Compatibility alias for older diagnostics consumers. */
    fallbackReason?: string;
}
/**
 * Return the built-in SoulForge registry. `externalPath` is intentionally a
 * rejection-only compatibility input; production never scans or reads it.
 */
export declare function resolveEmevdRegistry(externalPath?: string | null): EmedfResolutionResult;
