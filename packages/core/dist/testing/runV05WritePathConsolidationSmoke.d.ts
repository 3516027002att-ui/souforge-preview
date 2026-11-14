/**
 * v0.5 write-path consolidation smoke (P0).
 *
 * A. saveTextResource production trunk
 * B. text hash stale protection (stage → mutate original → commit fails)
 * C. explicit writer target mapping (same basename, different dirs)
 * D. raw edit safety
 * E. VFS bounded scan on large binary
 */
export {};
