/**
 * Graph Patch IR (architecture forks #110–#111).
 * Unifies file replace, text, raw range, field, node/edge, and container child ops.
 *
 * Scaffold only — native structured writers are not implemented here.
 */
/** Operations that scaffold adapters can apply to staging today. */
export const SCAFFOLD_SUPPORTED_PATCH_KINDS = [
    'file_replace',
    'raw_byte_range_edit',
    'text_edit',
    'synthetic_resource_edit',
    /** synthetic SFBN BND + DCX DFLT nested child replace (authoritative for owned fixtures). */
    'container_child_replace'
];
/**
 * Container mutations still without writers — always rejected.
 * container_child_replace is supported when hashes + content are present.
 */
export const NATIVE_WRITER_REQUIRED_KINDS = [
    'container_child_add',
    'container_child_delete',
    'container_child_rename',
    'container_child_move'
];
//# sourceMappingURL=patch-ir.js.map