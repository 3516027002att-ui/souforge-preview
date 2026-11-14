/**
 * SF-05: Map query intersection, batch targets, and snapshot reuse.
 *
 * Covers:
 *  - queryMapEntities multi-filter intersection (AND logic across modelName, entityId, kind, nameContains, regionName)
 *  - queryMapEntities regionName resolution and MAP_REFERENCE_COVERAGE_INCOMPLETE gate
 *  - batchTransformMapParts fail-fast target validation (MAP_ENTITY_NOT_FOUND, MAP_DUPLICATE_TARGET, zero staging calls)
 *  - batchTransformMapParts non-finite float rejection (MAP_INVALID_TRANSFORM)
 *  - batchTransformMapParts delta = 0 quantization / no-op detection (noop: true, effectiveCount: 0)
 *  - MapSnapshotLease lifecycle, validation, and reuse across query, batch, and transaction
 *  - executeMapTransaction sourceFileHash freshness check (MAP_SOURCE_MODIFIED)
 *  - verifiedPostState snapshot reuse eliminating redundant reloads
 */
export declare function runMapSelectionUnitTests(): Promise<void>;
export declare function runMapSelectionNativeTests(): Promise<void>;
