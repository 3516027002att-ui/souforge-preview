import { asIdList, asOptionalString, asRecord, asString, fail, ok, requireEditSession, searchQueryUnusable } from '../toolRegistrySupport.js';
import { searchParamFieldDefinitions } from '../../param/containerParamEdit.js';
/** search_param_fields: one domain tool declaration, schema and handler. */
export function createSearchParamFieldsTool() {
    return {
        name: 'search_param_fields',
        description: 'Search the trusted native PARAM definition for field IDs on an already located table/row. '
            + 'Pass table, non-empty rowIds, and a semantic query such as health/hp, elite/boss, hostile/team/target, '
            + 'lightning/effect, drop/reward/item, or a Chinese field name (距离, 判定距离). Chinese queries are folded '
            + '(繁/简, full-width) and expanded through a concept vocabulary, so 距离 matches a native name written '
            + '距離. Every field echoes its table and matchedBy (fieldId | name | description | cjk-variant); cjk-variant means the '
            + 'name only matched after folding or translation. description means only the field prose mentioned the term: '
            + 'it is weak evidence, so those fields come after every fieldId/name hit and carry descriptionSnippet '
            + '(the words around the hit) — use it to judge relevance instead of concluding the table has no such field. '
            + 'When the query names a TAE event field instead '
            + '(判定距离 is event 760 Reference Distance / Enable Range Maximum), crossDomainFields carries those TAE '
            + 'candidates with their semantics; nearestFields gives the closest real field names on a zero hit. '
            + 'For "which field is this name?" without a row first, use search_field_names. '
            + 'This returns metadata candidates only; use the returned real fieldId '
            + 'in read_param_fields, which requires a non-empty explicit fieldIds array. The result carries contentRevision '
            + '(sourceRevisionKind=content-hash), derived from the same PARAM child hash read_param_fields reports, so it '
            + 'is safe as a CAS/cache key; a file mtime is not. Follow nextActions with the original query and opaque cursor to read all fields; limit is a maximum, not a total. Do not parse Smithbox XML yourself.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            table: 'string',
            rowIds: 'array',
            query: 'string',
            limit: 'number?',
            cursor: 'string?',
            containerPath: 'string?'
        },
        run: async (input, context) => {
            const edit = requireEditSession(context, 'read');
            if (!('session' in edit))
                return edit;
            const value = asRecord(input);
            const table = asString(value.table);
            const rowIds = asIdList(value.rowIds);
            const query = asString(value.query);
            if (!table || rowIds.length === 0) {
                return fail('PARAM_FIELD_QUERY_REQUIRED', 'search_param_fields 需要 table 和非空 rowIds；query 可留空或用 "*" 表示列出该表的字段。');
            }
            const unusableQuery = query.trim() === '*' ? undefined : searchQueryUnusable(query);
            if (unusableQuery !== undefined)
                return fail('SEARCH_QUERY_UNUSABLE', unusableQuery);
            const containerPath = asOptionalString(value.containerPath);
            const result = await searchParamFieldDefinitions({
                edit: edit.session,
                table,
                rowIds,
                query,
                ...(typeof value.limit === 'number' ? { limit: value.limit } : {}),
                ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}),
                ...(containerPath ? { containerPath } : {})
            });
            if (!result.ok)
                return fail(result.error.code, result.error.message, result.error.details);
            // Zero fields used to come back as a bare empty list, which reads as "this table has no such
            // field" even when the query simply did not match the field vocabulary. Say which it is.
            const fields = result.fields ?? [];
            const nearest = result.nearestFields ?? [];
            const crossDomain = result.crossDomainFields ?? [];
            // TAE 字段命中时，即便 PARAM 也有结果，也要说清「这不是 PARAM 表里的字段」，
            // 否则 agent 会把 NpcParam 里同名的距离字段当成用户问的那个。
            const crossDomainNote = crossDomain.length === 0 ? undefined
                : `「${String(query).slice(0, 40)}」也命中 TAE 事件字段：`
                    + crossDomain.slice(0, 3).map((candidate) => `${String(candidate.eventName ?? '')}.${candidate.name}`).join('；')
                    + '。它们不在 PARAM 表里，语义见 crossDomainFields[].semantics。';
            // 说明命中是弱证据：同一句话里出现同一个词，不等于这个字段就是用户问的那个。
            // 不说清楚的话，调用方会把「说明里提到 boss」的字段当成「boss 字段」，或者反过来
            // 因为结果里只看到 isSoulGetByBoss 就断言这张表没有 boss/精英相关字段。
            const proseFields = fields.filter((field) => field.matchedBy === 'description');
            const proseNote = proseFields.length === 0 ? undefined
                : `其中 ${proseFields.slice(0, 4).map((field) => String(field.fieldId ?? '')).join('、')}`
                    + ' 只有说明文本提到查询词（matchedBy=description，弱证据，排在 fieldId/name 命中之后），'
                    + '不是名字命中；descriptionSnippet 给出命中处原文，请据此判断相关不相关，不要据此断言该表没有对应字段。';
            const note = fields.length > 0
                ? [proseNote, crossDomainNote].filter((part) => part !== undefined).join(' ') || undefined
                : `表 ${table} 中没有字面或折叠后匹配「${String(query).slice(0, 60)}」的字段定义；`
                    + (nearest.length > 0
                        ? `本表最接近的字段是 ${nearest.slice(0, 3).map((field) => field.name).join('、')}（nearestFields 给出原因）。`
                        : '本表没有相近的字段名。')
                    + ' 可以用字段的英文名（如 equipId）或 native 名称重试，或调用 search_field_names 按中文/英文名跨表查字段。'
                    + (crossDomain.length > 0 ? ` ${crossDomainNote}` : '');
            return ok({
                ...result,
                ...(note ? { note } : {}),
                nextActions: result.nextCursor
                    ? [{ tool: 'search_param_fields', args: { ...value, cursor: result.nextCursor }, reason: '继续读取字段定义。' }]
                    : []
            });
        }
    };
}
//# sourceMappingURL=search_param_fields.js.map