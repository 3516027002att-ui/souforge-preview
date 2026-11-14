import { createHash } from 'node:crypto';
import { createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
import { cursorIdentity } from '../workspace/cursorIdentity.js';
// v2: the wire scope carries cursorIdentity(sourceKey); sourceKey embeds the
// workspace id (absolute file:// URL). Unhashed v1 tokens are rejected.
const SOURCE_TEXT_SESSION = 'source-text-v2';
const DEFAULT_SOURCE_LIMIT = 2400;
const MAX_SOURCE_LIMIT = 16000;
const SOURCE_JSON_BUDGET = 3200;
function invalid(message, code = 'INVALID_SOURCE_WINDOW') {
    throw Object.assign(new Error(message), { code });
}
/** Read-only source windows. Offsets are UTF-16 positions; never split a surrogate pair. */
export function sourceTextPage(options) {
    const { text, sourceKey, domain } = options;
    const maxLimit = options.maxLimit ?? MAX_SOURCE_LIMIT;
    const jsonBudget = options.jsonBudget ?? SOURCE_JSON_BUDGET;
    let offset = options.sourceOffset ?? 0;
    let limit = options.sourceLimit ?? options.defaultLimit ?? DEFAULT_SOURCE_LIMIT;
    const fingerprint = createHash('sha256').update(options.sourceHash).update('\0').update(text).digest('hex');
    const textHash = createHash('sha256').update(text, 'utf8').digest('hex');
    if (options.cursor !== undefined) {
        if (options.sourceOffset !== undefined)
            invalid('续读时只传 cursor，不同时指定 sourceOffset。');
        const payload = parseOpaqueCursor(options.cursor);
        if (payload.sessionId !== SOURCE_TEXT_SESSION || payload.domain !== domain) {
            invalid('游标不属于当前正文读取。', 'SOURCE_CURSOR_SCOPE_MISMATCH');
        }
        let scope;
        try {
            scope = JSON.parse(payload.scope);
        }
        catch {
            invalid('正文游标范围无效。');
        }
        if (scope.sourceKey !== cursorIdentity(sourceKey) || !Number.isSafeInteger(scope.limit)) {
            invalid('游标与当前文件或子项不匹配。', 'SOURCE_CURSOR_SCOPE_MISMATCH');
        }
        if (options.sourceLimit !== undefined && options.sourceLimit !== scope.limit) {
            invalid('续读时不能改变 sourceLimit。', 'SOURCE_CURSOR_SCOPE_MISMATCH');
        }
        if (payload.sourceHash !== fingerprint)
            invalid('正文已经变化，请从头读取。', 'STALE_READ_CURSOR');
        offset = payload.offset;
        limit = scope.limit;
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length)
        invalid('sourceOffset 超出正文范围。');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit)
        invalid(`sourceLimit 必须为 1 到 ${maxLimit} 的整数。`);
    const splitsPair = (position) => position > 0 && position < text.length
        && /[\uD800-\uDBFF]/u.test(text[position - 1]) && /[\uDC00-\uDFFF]/u.test(text[position]);
    if (splitsPair(offset))
        invalid('sourceOffset 不能位于 Unicode 字符中间。');
    const boundedEnd = (position) => splitsPair(position) ? position - 1 : position;
    let end = boundedEnd(Math.min(text.length, offset + limit));
    // A one-character request at an astral character still makes progress.
    if (end === offset && offset < text.length)
        end = Math.min(text.length, offset + 2);
    const requestedEnd = end;
    if (Buffer.byteLength(JSON.stringify(text.slice(offset, end)), 'utf8') > jsonBudget) {
        let low = offset;
        let high = end;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            const candidate = boundedEnd(middle);
            if (Buffer.byteLength(JSON.stringify(text.slice(offset, candidate)), 'utf8') <= jsonBudget)
                low = middle;
            else
                high = middle - 1;
        }
        end = boundedEnd(low);
    }
    const sourceText = text.slice(offset, end);
    const hasMore = end < text.length;
    // The JSON budget can shrink a requested window; saying so avoids "limit 16000, returned 3084"
    // reading as a reader bug.
    const budgetClamped = end < requestedEnd;
    const startLine = text.slice(0, offset).split('\n').length;
    return {
        sourceText,
        sourceTextComplete: offset === 0 && !hasMore,
        total: text.length,
        totalCount: text.length,
        offset,
        limit,
        returned: sourceText.length,
        returnedCount: sourceText.length,
        truncated: offset > 0 || hasMore,
        hasMore,
        startLine,
        endLine: startLine + sourceText.split('\n').length - 1,
        ...(budgetClamped ? { effectiveLimit: sourceText.length, limitClampedBy: 'json-budget' } : {}),
        // Byte ranges of this page inside the whole text: the whole-script write proof is assembled
        // from the pages a caller actually received.
        fullUtf8Bytes: Buffer.byteLength(text, 'utf8'),
        pageStartByte: Buffer.byteLength(text.slice(0, offset), 'utf8'),
        pageEndByte: Buffer.byteLength(text.slice(0, end), 'utf8'),
        fullTextHash: textHash,
        ...(hasMore ? {
            nextCursor: createOpaqueCursor({
                sessionId: SOURCE_TEXT_SESSION, offset: end, sourceHash: fingerprint, domain,
                scope: JSON.stringify({ sourceKey: cursorIdentity(sourceKey), limit })
            })
        } : {})
    };
}
//# sourceMappingURL=sourceTextPage.js.map