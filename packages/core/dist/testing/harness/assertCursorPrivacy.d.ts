/**
 * Inspect the wire payload too: a base64 wrapper cannot conceal a host path.
 * Walks any tool result, decodes every `sf_cur_` token and asserts that none of
 * the forbidden host identities appears in the decoded JSON. Returns the number
 * of cursors inspected so callers can prove the assertion was not vacuous.
 */
export declare function assertCursorPrivacy(value: unknown, forbidden: readonly string[]): number;
