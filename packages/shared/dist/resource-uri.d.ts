/**
 * Stable resource / field URI model (architecture forks #102, #104).
 *
 * Resource identity must not rely on filesystem path alone.
 * This module provides typed URIs for overlay layers, containers, symbols, versions, and hashes.
 *
 * Scaffold only — not a full native format authority parser.
 */
import type { ResourceKind } from './types.js';
/** Writable / readable overlay layers in the workspace model. */
export type OverlayLayerId = 'base' | 'overlay' | 'staging' | 'generated' | 'synthetic';
/** Stable content hash (sha256 hex). */
export type ContentHash = string;
/** Monotonic or content-derived resource version token. */
export type ResourceVersion = string;
/**
 * Symbol path within a resource (event id, param row, field chain, etc.).
 * Segments are URI-encoded when formatted.
 */
export type SymbolPath = string;
/**
 * Canonical resource identity.
 * physicalPath is workspace-relative POSIX path of the host file.
 * containerPath is optional child path inside BND/DCX/etc.
 */
export interface ResourceURI {
    scheme: 'soulforge';
    game: string;
    overlay: OverlayLayerId;
    /** Workspace-relative physical path (POSIX). */
    physicalPath: string;
    /** Optional path inside a container (BND child, nested archive, etc.). */
    containerPath?: string;
    resourceKind: ResourceKind;
    /** Optional semantic symbol path (e.g. events/1000/instructions/3). */
    symbolPath?: SymbolPath;
    version?: ResourceVersion;
    contentHash?: ContentHash;
}
/**
 * Field-level identity under a resource.
 * fieldPath uses dotted segments (row.field.sub).
 */
export interface FieldURI {
    resource: ResourceURI;
    fieldPath: string;
}
export interface CreateResourceUriInput {
    game?: string;
    overlay?: OverlayLayerId;
    physicalPath: string;
    containerPath?: string;
    resourceKind: ResourceKind;
    symbolPath?: SymbolPath;
    version?: ResourceVersion;
    contentHash?: ContentHash;
}
export interface CreateFieldUriInput extends CreateResourceUriInput {
    fieldPath: string;
}
export interface ResourceUriValidation {
    ok: boolean;
    errors: string[];
}
/**
 * Create a ResourceURI from structured parts.
 */
export declare function createResourceUri(input: CreateResourceUriInput): ResourceURI;
export declare function createFieldUri(input: CreateFieldUriInput): FieldURI;
/**
 * Format ResourceURI to a stable string.
 *
 * soulforge://{game}/{overlay}/{kind}/{physicalPath}
 *   [?container=][&symbol=][&v=][&hash=]
 *
 * Uses an authority (game) so URL parsing is stable across runtimes.
 */
export declare function formatResourceUri(uri: ResourceURI): string;
export declare function formatFieldUri(field: FieldURI): string;
/**
 * Parse a soulforge ResourceURI string.
 * Throws on unrecoverable syntax errors; use validateResourceUri for soft checks.
 */
export declare function parseResourceUri(value: string): ResourceURI;
export declare function parseFieldUri(value: string): FieldURI;
export declare function tryParseResourceUri(value: string): ResourceUriValidation & {
    uri?: ResourceURI;
};
export declare function tryParseFieldUri(value: string): ResourceUriValidation & {
    field?: FieldURI;
};
export declare function validateResourceUri(uri: ResourceURI | string): ResourceUriValidation;
export declare function validateFieldUri(field: FieldURI | string): ResourceUriValidation;
/** Compare identity ignoring version/hash (stable resource key). */
export declare function resourceUriIdentityKey(uri: ResourceURI): string;
export declare function isOverlayLayerId(value: string): value is OverlayLayerId;
