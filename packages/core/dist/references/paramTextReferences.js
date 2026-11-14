/**
 * 这些是 Smithbox SDT Row FMG Annotations 中当前已确认的参数→标题域。
 * category/sourceUri 允许不同 Bridge 导出使用 Title_Goods、Goods、item 或
 * アイテム名等不同名称，但必须仍然命中对应的文本容器，不对所有 FMG 做
 * rowId 猜测。
 */
const ROW_FMG_ASSOCIATIONS = {
    equipparamaccessory: ['title_accessories', 'accessories', 'accessory'],
    equipparamgoods: ['title_goods', 'goods', 'item', 'itemname', 'アイテム名'],
    equipparamweapon: ['title_weapons', 'weapons', 'weapon'],
    equipparamprotector: ['title_armor', 'armor', 'protector'],
    magic: ['title_magic', 'magic']
};
const MAX_PARAM_TEXT_LINKS = 16;
export function buildTextEntryLookup(msgExports) {
    const lookup = new Map();
    for (const msgExport of msgExports) {
        for (const entry of msgExport.entries) {
            const matches = lookup.get(entry.textId) ?? [];
            matches.push(entry);
            lookup.set(entry.textId, matches);
        }
    }
    return lookup;
}
/** 只接受明确的非负整数引用；-1 等 PARAM 空槽永远不会变成文本候选。 */
export function parseParamTextReference(value) {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\s*\d+\s*$/.test(value)
            ? Number(value.trim())
            : null;
    return numeric !== null && Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
}
const PARAM_TEXT_FIELD_CACHE_CAPACITY = 4096;
// Field ids are stable within a trusted schema.  Keep the shape alongside the
// result so a changed metadata package cannot reuse an old classification.
// Unlike the previous per-call string-keyed LRU, cache hits only compare the
// already-present metadata properties and never construct/delete/reinsert a key.
const paramTextFieldCacheById = new Map();
const paramTextFieldCacheByName = new Map();
function cacheEntry(field, result) {
    return {
        name: field.name,
        ...(field.type !== undefined ? { type: field.type } : {}),
        ...(field.description !== undefined ? { description: field.description } : {}),
        refsProvenance: field.refsProvenance,
        result
    };
}
function sameFieldShape(left, right) {
    return left.name === right.name
        && left.type === right.type
        && left.description === right.description
        && left.refsProvenance === right.refsProvenance;
}
function cacheParamTextFieldResult(cache, key, field, result) {
    cache.set(key, cacheEntry(field, result));
    while (cache.size > PARAM_TEXT_FIELD_CACHE_CAPACITY) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined)
            break;
        cache.delete(oldest);
    }
}
function classifyParamTextField(field) {
    const cache = field.fieldId ? paramTextFieldCacheById : paramTextFieldCacheByName;
    const key = field.fieldId ?? field.name;
    const cached = cache.get(key);
    if (cached !== undefined && sameFieldShape(cached, field))
        return cached.result;
    const result = evaluateParamTextReferenceField(field);
    cacheParamTextFieldResult(cache, key, field, result);
    return result;
}
export function createParamTextFieldClassifier(fields) {
    const byId = new Map();
    const byName = new Map();
    for (const field of fields) {
        const cache = field.fieldId ? byId : byName;
        const key = field.fieldId ?? field.name;
        cache.set(key, cacheEntry(field, evaluateParamTextReferenceField(field)));
    }
    return {
        isTextReferenceField(field) {
            const cache = field.fieldId ? byId : byName;
            const key = field.fieldId ?? field.name;
            const cached = cache.get(key);
            if (cached !== undefined && sameFieldShape(cached, field))
                return cached.result;
            const result = classifyParamTextField(field);
            cache.set(key, cacheEntry(field, result));
            return result;
        }
    };
}
/**
 * PARAM metadata 没有携带完整的 FmgRef XML 属性时，仍只能按字段语义识别
 * 文本引用。字段名/说明不满足明确模式就不查 FMG，避免把 itemId、iconId
 * 等普通整数误解释成 textId。
 */
export function isParamTextReferenceField(field) {
    return classifyParamTextField(field);
}
function evaluateParamTextReferenceField(field) {
    const fieldId = compactToken(field.fieldId ?? '');
    if (fieldId.length > 0 && isTextIdToken(fieldId))
        return true;
    const labels = [field.name, field.description].filter((value) => (typeof value === 'string' && value.trim().length > 0));
    return labels.some((label) => {
        const lower = label.toLowerCase();
        const hasTextWord = /text|msg|message|fmg|文本|文字|消息|名称|名字|标题|描述/iu.test(lower);
        const hasIdWord = /id|编号|索引|引用/iu.test(lower);
        return hasTextWord && hasIdWord;
    });
}
/**
 * Return all source-backed text entries for one PARAM row. The result is
 * deterministic and bounded so a wide row cannot create a RAG/CPU amplifier.
 */
export function collectParamTextLinks(row, textEntriesById, maxLinks = MAX_PARAM_TEXT_LINKS, classifier) {
    if (maxLinks <= 0)
        return [];
    const byUri = new Map();
    for (const field of row.fields ?? []) {
        if (!(classifier?.isTextReferenceField(field) ?? isParamTextReferenceField(field)))
            continue;
        const referenceValue = parseParamTextReference(field.value);
        if (referenceValue === null)
            continue;
        for (const entry of textEntriesById.get(referenceValue) ?? []) {
            byUri.set(entry.uri, {
                ...(field.fieldId ? { fieldId: field.fieldId } : {}),
                referenceValue,
                kind: 'field-text-id',
                entry
            });
        }
    }
    const association = rowFmgAssociation(row.paramName);
    if (association.length > 0) {
        for (const entry of textEntriesById.get(row.rowId) ?? []) {
            if (!matchesTextDomain(entry, association))
                continue;
            // An explicit field relation is stronger than the row-FMG fallback when
            // both point to the same URI.
            if (byUri.has(entry.uri))
                continue;
            byUri.set(entry.uri, {
                referenceValue: row.rowId,
                kind: 'row-fmg-id',
                entry
            });
        }
    }
    return [...byUri.values()]
        .sort((left, right) => {
        const kindDelta = linkRank(right.kind) - linkRank(left.kind);
        if (kindDelta !== 0)
            return kindDelta;
        const categoryDelta = (left.entry.category ?? '').localeCompare(right.entry.category ?? '');
        if (categoryDelta !== 0)
            return categoryDelta;
        return left.entry.uri.localeCompare(right.entry.uri);
    })
        .slice(0, maxLinks);
}
/** Search projection shared by native PARAM search and RAG chunk building. */
export function paramTextLinkSearchText(links) {
    return links.map((link) => [
        `textRef=${link.kind}`,
        link.fieldId,
        `textId=${link.referenceValue}`,
        link.entry.category,
        link.entry.text,
        link.entry.uri
    ].filter(Boolean).join(' ')).join(' ');
}
/**
 * Build graph edges for PARAM↔FMG links without numeric-fallback noise.
 * This intentionally avoids a module-level full-field token snapshot: the
 * WorkspaceIndex caches the graph by projection generation, while a second
 * snapshot cache retained O(all PARAM fields) and shared a mutable edge array.
 */
export function buildParamTextReferenceEdges(params, msgExports) {
    const lookup = buildTextEntryLookup(msgExports);
    const edges = [];
    const seen = new Set();
    for (const paramExport of params) {
        const classifier = createParamTextFieldClassifier(paramExport.rows[0]?.fields ?? []);
        for (const row of paramExport.rows) {
            for (const link of collectParamTextLinks(row, lookup, MAX_PARAM_TEXT_LINKS, classifier)) {
                const key = `${row.uri}\u0000${link.entry.uri}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const relation = link.kind === 'field-text-id'
                    ? `字段 ${link.fieldId ?? 'text-reference'} 明确指向文本 ID ${link.referenceValue}`
                    : `已声明的 Row-FMG 关联将 ${row.paramName} 行 ${row.rowId} 映射到文本 ID ${link.referenceValue}`;
                edges.push({
                    fromUri: row.uri,
                    toUri: link.entry.uri,
                    kind: 'references_text',
                    confidence: 'high',
                    reason: `PARAM↔FMG source-backed link: ${relation}。`,
                    evidence: [{
                            sourceUri: row.sourceUri,
                            fieldName: link.fieldId ?? 'rowId',
                            value: link.referenceValue,
                            excerpt: `${row.paramName}#${row.rowId} -> ${link.entry.category ?? 'text'}#${link.entry.textId}: ${link.entry.text}`
                        }]
                });
            }
        }
    }
    return edges;
}
const rowFmgAssociationCache = new Map();
function rowFmgAssociation(paramName) {
    const cached = rowFmgAssociationCache.get(paramName);
    if (cached !== undefined)
        return cached;
    // Native ParamDef exports use the physical *_ST names (for example
    // EQUIP_PARAM_GOODS_ST), while the mature-tool annotations use the logical
    // domain name (EquipParamGoods). Normalize only that documented suffix; do
    // not strip arbitrary digits or names because those can identify a
    // different table.
    const normalized = compactToken(paramName).replace(/st$/u, '');
    const result = ROW_FMG_ASSOCIATIONS[normalized] ?? [];
    rowFmgAssociationCache.set(paramName, result);
    return result;
}
const entryHaystackCache = new WeakMap();
function matchesTextDomain(entry, domains) {
    let haystack = entryHaystackCache.get(entry);
    if (haystack === undefined) {
        haystack = compactToken([
            entry.category,
            entry.sourceUri,
            entry.uri
        ].filter(Boolean).join(' '));
        entryHaystackCache.set(entry, haystack);
    }
    return domains.some((domain) => haystack.includes(compactToken(domain)));
}
function isTextIdToken(value) {
    return /(?:^|\d)(?:name|description|desc|title|caption|role|text|msg|message|fmg)(?:id|index|idx)?$/.test(value)
        || /(?:name|description|desc|title|caption|role|text|msg|message|fmg)(?:id|index|idx)/.test(value);
}
const compactTokenCache = new Map();
function compactToken(value) {
    const cached = compactTokenCache.get(value);
    if (cached !== undefined)
        return cached;
    const result = value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/giu, '');
    if (compactTokenCache.size < 50_000)
        compactTokenCache.set(value, result);
    return result;
}
function linkRank(kind) {
    return kind === 'field-text-id' ? 2 : 1;
}
//# sourceMappingURL=paramTextReferences.js.map